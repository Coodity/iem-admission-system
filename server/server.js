// server/server.js
import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
// Native bcrypt hashes on libuv worker threads, so concurrent logins run in parallel (load test LT-03/04).
// Same $2a$/$2b$ hash format as bcryptjs, which stays as a fallback if the native module cannot load.
let bcrypt;
try {
  bcrypt = (await import('bcrypt')).default;
} catch {
  bcrypt = (await import('bcryptjs')).default;
  console.warn('Native bcrypt unavailable; using bcryptjs (slower logins under load)');
}
import cors from 'cors';
import multer from 'multer';
import PDFDocument from 'pdfkit';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const app = express();
app.use(cors());
app.use(express.json());

const UPLOAD_DIR = path.resolve('uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- Rules ----------
const APPLICATION_FEE = 500;                 // FR-6.2 sandbox amount (confirm with faculty)
const MIN_AGE = 17;                          // assumption, confirm with faculty
const OTP_MINUTES = 10;                      // FR-1.1
const RESET_MINUTES = 30;                    // FR-2.1 reset token valid for 30 min, single use
const RESET_MAX_ATTEMPTS = 5;                // wrong codes allowed before a new one is needed
const RESET_RESEND_SECONDS = 60;             // minimum gap between reset emails
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const IDLE_MINUTES = 15;                     // FR-20.1 idle timeout
const IDLE_MS = IDLE_MINUTES * 60 * 1000;
const TOUCH_MS = 30 * 1000;                  // how often lastSeen is written back
const REQUIRED_DOCS = ['Mark sheet', 'ID Proof', 'Photo']; // FR-5.2
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_FILE_BYTES = 5 * 1024 * 1024;      // FR-5.3
const STATUSES = ['Submitted', 'Under Review', 'Approved', 'Rejected']; // FR-13.2
const FEE_TYPES = ['Application', 'Admission'];
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_RX = /^[A-Za-z ]+$/;              // FR-1.1
const PHONE_RX = /^\d{10}$/;                 // FR-1.1
const PASSWORD_RX = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,20}$/; // FR-1.1 / NFR-2
const TOKEN_RX = /^[a-f0-9]{64}$/;           // FR-16.1 64-character session token

// FR-16.1 Permission set: the modules each role may use. Checked on every request (NFR-4).
const OFFICER_PERMS = ['applications:review', 'documents:verify', 'fees:record', 'applications:decide'];
const PERMISSIONS = Object.freeze({
  applicant: ['application:own', 'notifications:own'],
  officer: OFFICER_PERMS,
  admin: [...OFFICER_PERMS, 'courses:manage', 'staff:manage', 'audit:view', 'notifications:view', 'reports:view'],
});
const can = (role, perm) => (PERMISSIONS[role] || []).includes(perm);

const COURSE_SEED = [ // sample data, replace with faculty's real courses
  { name: 'B.Tech Computer Science', campuses: ['Main Campus', 'City Campus'], minPercent: 60, fee: 25000 },
  { name: 'B.Tech Electronics', campuses: ['Main Campus'], minPercent: 55, fee: 22000 },
  { name: 'BBA', campuses: ['City Campus'], minPercent: 50, fee: 15000 },
];

// ---------- Helpers ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const normEmail = (e = '') => String(e).trim().toLowerCase();
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
const hasPaid = (app, type) => app.payments.some((p) => p.type === type && p.status === 'Success');
const makeRef = (prefix) => `${prefix}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
const allDocsVerified = (a) => REQUIRED_DOCS.every((label) => a.docs.some((d) => d.label === label && d.status === 'Verified'));
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const publicUser = (u) => ({ id: String(u._id), name: u.name, email: u.email, role: u.role, permissions: PERMISSIONS[u.role] });

function ageOn(d) {
  const t = new Date();
  let a = t.getFullYear() - d.getFullYear();
  const m = t.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < d.getDate())) a--;
  return a;
}

// Parses ?from=YYYY-MM-DD&to=YYYY-MM-DD into a Mongo range. "to" is inclusive of that whole day.
function dateRange(q) {
  const parse = (s, label) => {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : null;
    if (!d || isNaN(d)) throw new HttpError(400, `${label} date is not valid`);
    return d;
  };
  const range = {};
  if (q.from) range.$gte = parse(String(q.from), 'From');
  if (q.to) range.$lt = new Date(parse(String(q.to), 'To').getTime() + 24 * 60 * 60 * 1000);
  if (range.$gte && range.$lt && range.$gte >= range.$lt) throw new HttpError(400, 'From date must be on or before To date');
  return Object.keys(range).length ? range : null;
}

async function issueOtp(user) {
  const code = String(crypto.randomInt(100000, 1000000));
  user.otpHash = await bcrypt.hash(code, 10);
  user.otpExpires = new Date(Date.now() + OTP_MINUTES * 60 * 1000);
  await user.save();
  console.log(`[sandbox OTP] ${user.email}: ${code} (expires in ${OTP_MINUTES} min)`);
}

// Sandboxed email service (IR-5). Set SANDBOX_EMAIL_FAIL_RATE=0.3 in .env to simulate failures.
async function sandboxSendEmail(to, content) {
  if (!to || !EMAIL_RX.test(to)) throw new Error('Recipient email is missing or invalid');
  if (Math.random() < Number(process.env.SANDBOX_EMAIL_FAIL_RATE || 0)) throw new Error('Sandbox mail service rejected the message');
  console.log(`[sandbox email] to ${to}: ${content}`);
}

// FR-14: every notification is stored with its delivery result. A failed send never fails the staff action.
async function notify(app, trigger, content) {
  const user = await User.findById(app.applicant).select('email');
  const text = String(content).slice(0, 300);
  let deliveryStatus = 'Sent';
  let failureReason = '';
  try {
    await sandboxSendEmail(user?.email, text);
  } catch (err) {
    deliveryStatus = 'Failed';
    failureReason = err.message;
    console.warn(`[sandbox email] FAILED for ${app.appId}: ${err.message}`);
  }
  await Notification.create({
    applicantId: String(app.applicant), applicantEmail: user?.email || '', appId: app.appId,
    trigger, content: text, sentAt: new Date(), deliveryStatus, failureReason,
  });
}

// FR-15 / NFR-7: append-only. The model below rejects updates and deletes, and no route edits it.
async function audit(user, action, target) {
  await AuditLog.create({
    logId: `LOG${crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 9)}`,
    userId: user.id, userName: user.name, role: user.role, action, target: String(target),
  });
}

// ---------- Models ----------
const User = mongoose.model('User', new mongoose.Schema({
  name: { type: String, required: true, maxlength: 100 },
  email: { type: String, unique: true, required: true, lowercase: true, trim: true, maxlength: 100 },
  phone: String,
  dob: Date,
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['applicant', 'officer', 'admin'], default: 'applicant' },
  verified: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
  otpHash: String,
  otpExpires: Date,
  // FR-2.3 password reset: 6-digit code and 64-char link token, both stored only as hashes
  resetCodeHash: String,
  resetTokenHash: String,
  resetExpires: Date,
  resetAttempts: { type: Number, default: 0 },
  resetSentAt: Date,
}, { timestamps: true }));

// FR-16.1 / FR-20: server-side session. Only the SHA-256 of the 64-char token is stored.
// lastSeen slides on each request; MongoDB's TTL index also purges idle sessions.
const Session = mongoose.model('Session', new mongoose.Schema({
  tokenHash: { type: String, unique: true, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  lastSeen: { type: Date, default: Date.now, expires: IDLE_MINUTES * 60 },
}, { timestamps: { createdAt: true, updatedAt: false } }));

const Course = mongoose.model('Course', new mongoose.Schema({
  name: { type: String, required: true, unique: true, maxlength: 100 },
  campuses: [{ type: String, maxlength: 100 }],
  minPercent: { type: Number, required: true, min: 0, max: 100 },
  fee: { type: Number, required: true, min: 0 },   // FR-17.1 admission fee
  active: { type: Boolean, default: true },        // FR-17.1 controls the FR-3.2 dropdown
}));

const DocSchema = new mongoose.Schema({
  label: String,
  fileName: String,
  originalName: String,
  status: { type: String, enum: ['Pending', 'Verified', 'Rejected'], default: 'Pending' },
  reason: { type: String, default: '' },
  reuploads: { type: Number, default: 0 },          // FR-11.1 re-upload count
  uploadedAt: Date,
  verifiedBy: String,
  verifiedById: String,
  verifiedAt: Date,
});

const PaymentSchema = new mongoose.Schema({
  type: { type: String, enum: FEE_TYPES },
  amount: Number,
  reference: String,
  status: { type: String, enum: ['Success', 'Failed', 'Pending'] },
  at: Date,
});

// FR-12.1: officer's record of fee status. Kept as a list so earlier records are never overwritten.
const FeeRecordSchema = new mongoose.Schema({
  type: { type: String, enum: FEE_TYPES, required: true },
  status: { type: String, enum: ['Pending', 'Paid'], required: true },
  amount: { type: Number, required: true },
  recordedBy: String,
  recordedById: String,
  recordedAt: { type: Date, default: Date.now },
});

const Application = mongoose.model('Application', new mongoose.Schema({
  appId: { type: String, unique: true },
  applicant: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true }, // FR-4.2
  applicantName: String,
  course: String,
  campus: String,
  qualification: String,
  marks: Number,
  docs: [DocSchema],
  payments: [PaymentSchema],
  feeRecords: [FeeRecordSchema],
  feeVerified: { type: Boolean, default: false },  // true while the latest Application-fee record is Paid
  feeVerifiedBy: String,
  status: { type: String, enum: STATUSES, default: 'Submitted' },
  decisionReason: { type: String, default: '' },
  history: [{ status: String, at: Date, by: String, byId: String }], // FR-13.1 status history log
}, { timestamps: true }));

const AuditSchema = new mongoose.Schema({
  logId: { type: String, unique: true },
  userId: String,
  userName: String,
  role: String,
  action: { type: String, maxlength: 100 },
  target: String,
  at: { type: Date, default: Date.now, immutable: true },
});
function rejectMutation(next) { next(new Error('Audit log entries are immutable')); }
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  AuditSchema.pre(op, { document: true, query: true }, rejectMutation);
}
AuditSchema.pre('save', function (next) {
  if (!this.isNew) return next(new Error('Audit log entries are immutable'));
  next();
});
const AuditLog = mongoose.model('AuditLog', AuditSchema);

const Notification = mongoose.model('Notification', new mongoose.Schema({
  applicantId: String,
  applicantEmail: String,
  appId: String,
  trigger: String,
  content: { type: String, maxlength: 300 },
  sentAt: { type: Date, default: Date.now },
  deliveryStatus: { type: String, enum: ['Sent', 'Failed'], default: 'Sent' }, // FR-14.1
  failureReason: { type: String, default: '' },
}));

// ---------- Upload config (FR-5) ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) =>
      cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()),
  }),
  // busboy treats a file that reaches fileSize as too large, so allow exactly 5 MB with +1 (defect D-02)
  limits: { fileSize: MAX_FILE_BYTES + 1 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_MIME.includes(file.mimetype)),
});

// ---------- Auth middleware (FR-16, FR-20, NFR-4) ----------
// Validates the 64-char token against the session store, enforces the idle timeout,
// re-reads role and active flag from the DB, then checks the permission set.
function auth(permission) {
  return wrap(async (req, res, next) => {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!TOKEN_RX.test(token)) return res.status(401).json({ error: 'Please log in to continue.' });
    // One round trip: the session plus its user's current role and active flag (load test LT-05/06)
    const [session] = await Session.aggregate([
      { $match: { tokenHash: hashToken(token) } },
      { $limit: 1 },
      { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user',
        pipeline: [{ $project: { active: 1, role: 1, name: 1 } }] } },
    ]);
    const now = Date.now();
    if (!session || now - session.lastSeen.getTime() > IDLE_MS) {
      if (session) await Session.deleteOne({ _id: session._id });
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    const user = session.user[0];
    if (!user || !user.active) {
      await Session.deleteMany({ userId: session.userId });
      return res.status(401).json({ error: 'Account unavailable' });
    }
    if (permission && !can(user.role, permission)) {
      return res.status(403).json({ error: 'You do not have access to this page' });
    }
    if (now - session.lastSeen.getTime() > TOUCH_MS) {
      await Session.updateOne({ _id: session._id }, { $set: { lastSeen: new Date(now) } });
    }
    req.user = { id: String(user._id), role: user.role, name: user.name };
    req.sessionId = session._id;
    next();
  });
}

const anyRole = auth(null);

// Invalid ids become 404 instead of a CastError 500
app.param('id', (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) return res.status(404).json({ error: 'Not found' });
  next();
});

// ---------- Auth ----------
app.post('/api/auth/register', wrap(async (req, res) => {
  const { name = '', email = '', phone = '', dob = '', password = '', confirmPassword = '' } = req.body;
  const errors = {};
  if (!NAME_RX.test(name.trim()) || name.trim().length > 100) errors.name = 'Use letters and spaces only';
  if (!EMAIL_RX.test(email.trim()) || email.trim().length > 100) errors.email = 'Enter a valid email address';
  if (!PHONE_RX.test(phone)) errors.phone = 'Enter a 10-digit phone number';
  const dobDate = new Date(dob);
  if (!dob || isNaN(dobDate) || ageOn(dobDate) < MIN_AGE) errors.dob = `You must be at least ${MIN_AGE} years old`;
  if (!PASSWORD_RX.test(password)) errors.password = '8-20 characters with 1 uppercase letter, 1 number and 1 symbol';
  if (password !== confirmPassword) errors.confirmPassword = 'Passwords do not match';
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please fix the highlighted fields', errors });
  }
  const emailNorm = normEmail(email);
  if (await User.exists({ email: emailNorm })) {
    return res.status(409).json({ error: 'This email is already registered', errors: { email: 'Email already in use' } });
  }
  const user = await User.create({
    name: name.trim(),
    email: emailNorm,
    phone,
    dob: dobDate,
    passwordHash: await bcrypt.hash(password, 10),
  });
  await issueOtp(user);
  res.status(201).json({ email: user.email, message: 'Verification code sent' });
}));

app.post('/api/auth/verify-otp', wrap(async (req, res) => {
  const user = await User.findOne({ email: normEmail(req.body.email) });
  if (!user || user.verified) return res.status(400).json({ error: 'Invalid request' });
  if (!user.otpExpires || user.otpExpires < new Date()) {
    return res.status(400).json({ error: 'Code expired. Request a new one.' });
  }
  if (!(await bcrypt.compare(String(req.body.code || ''), user.otpHash || ''))) {
    return res.status(400).json({ error: 'Incorrect code. Please try again.' });
  }
  user.verified = true;
  user.otpHash = undefined;
  user.otpExpires = undefined;
  await user.save();
  res.json({ message: 'Email verified. You can log in now.' });
}));

app.post('/api/auth/resend-otp', wrap(async (req, res) => {
  const user = await User.findOne({ email: normEmail(req.body.email) });
  if (user && !user.verified) await issueOtp(user);
  res.json({ message: 'If the account exists, a new code was sent.' });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { email = '', password = '' } = req.body;
  const user = await User.findOne({ email: normEmail(email) });
  if (!user || !(await bcrypt.compare(String(password), user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (!user.active) return res.status(403).json({ error: 'This account is deactivated' }); // FR-8.1
  // Separate applicant (FR-2) and staff (FR-8) login portals
  const portal = req.body.portal;
  const isStaff = user.role !== 'applicant';
  if (portal === 'applicant' && isStaff) {
    return res.status(403).json({ error: 'This is a staff account. Please use Staff login.' });
  }
  if (portal === 'staff' && !isStaff) {
    return res.status(403).json({ error: 'This is an applicant account. Please use Applicant login.' });
  }
  if (!user.verified) return res.status(403).json({ error: 'Please verify your email first' });
  const token = crypto.randomBytes(32).toString('hex'); // 64 hex characters
  await Session.create({ tokenHash: hashToken(token), userId: user._id });
  res.json({ token, user: publicUser(user), idleMinutes: IDLE_MINUTES });
}));

// ---------- Forgot / reset password (FR-2.3) ----------
// Sandboxed: the code and link are printed in the server terminal instead of being emailed.
// The reply is the same whether or not the email exists, so accounts cannot be discovered.
app.post('/api/auth/forgot-password', wrap(async (req, res) => {
  const email = normEmail(req.body.email);
  if (!EMAIL_RX.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  const generic = { message: 'If an account exists for this email, a verification code has been sent.' };
  const user = await User.findOne({ email });
  if (!user || !user.active || !user.verified) return res.json(generic);
  if (user.resetSentAt && Date.now() - user.resetSentAt.getTime() < RESET_RESEND_SECONDS * 1000) {
    return res.json(generic); // too soon; the previous code is still valid
  }
  const code = String(crypto.randomInt(100000, 1000000));
  const token = crypto.randomBytes(32).toString('hex'); // 64 characters
  user.resetCodeHash = await bcrypt.hash(code, 10);
  user.resetTokenHash = hashToken(token);
  user.resetExpires = new Date(Date.now() + RESET_MINUTES * 60 * 1000);
  user.resetAttempts = 0;
  user.resetSentAt = new Date();
  await user.save();
  const link = `${CLIENT_URL}/forgot-password?email=${encodeURIComponent(user.email)}&token=${token}`;
  console.log(`[sandbox email] Password reset for ${user.email}`);
  console.log(`   Verification code: ${code}  (valid ${RESET_MINUTES} min, single use)`);
  console.log(`   Reset link: ${link}`);
  res.json(generic);
}));

app.post('/api/auth/reset-password', wrap(async (req, res) => {
  const { email = '', code = '', password = '', confirmPassword = '' } = req.body;
  const errors = {};
  if (!PASSWORD_RX.test(password)) errors.password = '8-20 characters with 1 uppercase letter, 1 number and 1 symbol';
  if (password !== confirmPassword) errors.confirmPassword = 'Passwords do not match';
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Please fix the highlighted fields', errors });

  const invalid = () => res.status(400).json({ error: 'The code is invalid or has expired. Request a new one.' });
  const user = await User.findOne({ email: normEmail(email) });
  if (!user || !user.resetExpires || (!user.resetCodeHash && !user.resetTokenHash)) return invalid();
  if (user.resetExpires < new Date() || user.resetAttempts >= RESET_MAX_ATTEMPTS) return invalid();

  const value = String(code).trim();
  const ok = TOKEN_RX.test(value)
    ? hashToken(value) === user.resetTokenHash
    : /^\d{6}$/.test(value) && (await bcrypt.compare(value, user.resetCodeHash || ''));
  if (!ok) {
    user.resetAttempts += 1;
    await user.save();
    const left = RESET_MAX_ATTEMPTS - user.resetAttempts;
    return res.status(400).json({
      error: left > 0 ? `Incorrect code. ${left} attempt(s) left.` : 'Too many incorrect attempts. Request a new code.',
      errors: { code: 'Incorrect code' },
    });
  }
  if (await bcrypt.compare(password, user.passwordHash)) {
    return res.status(400).json({ error: 'Choose a password different from your current one', errors: { password: 'Same as current password' } });
  }
  user.passwordHash = await bcrypt.hash(password, 10);
  user.resetCodeHash = undefined; // single use
  user.resetTokenHash = undefined;
  user.resetExpires = undefined;
  user.resetAttempts = 0;
  await user.save();
  await Session.deleteMany({ userId: user._id }); // sign out every existing session
  console.log(`[auth] Password reset completed for ${user.email}`);
  res.json({ message: 'Password changed. You can log in with your new password.', role: user.role });
}));

// Keeps the session alive while the user is active in the browser but not making requests
app.post('/api/auth/refresh', anyRole, (req, res) => res.json({ ok: true }));

app.post('/api/auth/logout', anyRole, wrap(async (req, res) => {
  await Session.deleteOne({ _id: req.sessionId });
  res.json({ ok: true });
}));

app.get('/api/auth/me', anyRole, wrap(async (req, res) => {
  const user = await User.findById(req.user.id).select('name email role');
  res.json(publicUser(user));
}));

// ---------- Public course data (FR-3.2): active courses only ----------
app.get('/api/courses', wrap(async (req, res) => {
  const courses = await Course.find({ active: true }).select('name campuses minPercent fee').sort({ name: 1 });
  res.json(courses);
}));

// ---------- Applicant: application (FR-3, FR-4) ----------
const own = auth('application:own');

app.get('/api/applications/mine', own, wrap(async (req, res) => {
  const app = await Application.findOne({ applicant: req.user.id });
  res.json(app); // null if no application yet
}));

app.post('/api/applications', own, wrap(async (req, res) => {
  if (await Application.exists({ applicant: req.user.id })) {
    return res.status(409).json({ error: 'You already have an application' });
  }
  const { course, campus, qualification = '', marks } = req.body;
  const c = await Course.findOne({ name: course, active: true });
  if (!c) return res.status(400).json({ error: 'Choose a valid course' });
  if (!c.campuses.includes(campus)) return res.status(400).json({ error: 'Choose a valid campus for this course' });
  if (!String(qualification).trim() || String(qualification).length > 50) {
    return res.status(400).json({ error: 'Enter your highest qualification (up to 50 characters)' });
  }
  // Blank marks must not be read as 0 (Number('') === 0) (defect D-01)
  const score = marks === null || marks === undefined || String(marks).trim() === '' ? NaN : Number(marks);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    return res.status(400).json({ error: 'Enter marks between 0 and 100' });
  }
  if (score < c.minPercent) {
    // Eligibility is checked before an Application ID is issued
    return res.status(422).json({
      error: `Not eligible: ${c.name} requires at least ${c.minPercent}%`,
      eligible: false,
    });
  }
  const user = await User.findById(req.user.id).select('name');
  const app = await Application.create({
    appId: makeRef('IEM'),
    applicant: req.user.id,
    applicantName: user.name,
    course,
    campus,
    qualification: String(qualification).trim(),
    marks: score,
    history: [{ status: 'Submitted', at: new Date(), by: user.name, byId: req.user.id }],
  });
  await audit(req.user, 'Application created', app.appId);
  res.status(201).json(app);
}));

// FR-5 upload, FR-11.5 re-upload after rejection
app.post('/api/applications/documents', own, upload.single('file'), wrap(async (req, res) => {
  const label = req.body.label;
  if (!REQUIRED_DOCS.includes(label)) return res.status(400).json({ error: 'Unknown document type' });
  if (!req.file) return res.status(400).json({ error: 'Upload a JPEG, PNG or PDF file up to 5 MB' });
  const app = await Application.findOne({ applicant: req.user.id });
  if (!app) return res.status(400).json({ error: 'Create your application first' });
  const existing = app.docs.find((d) => d.label === label);
  const isReupload = app.status === 'Under Review' && existing?.status === 'Rejected';
  if (app.status !== 'Submitted' && !isReupload) {
    return res.status(400).json({ error: 'Documents are locked after submission. Only rejected documents can be re-uploaded.' });
  }
  if (existing && existing.status === 'Verified') {
    return res.status(409).json({ error: `${label} is already verified` });
  }
  const entry = {
    label,
    fileName: req.file.filename,
    originalName: req.file.originalname,
    uploadedAt: new Date(),
    status: 'Pending',
    reason: '',
    reuploads: existing ? existing.reuploads + (existing.status === 'Rejected' ? 1 : 0) : 0,
    verifiedBy: undefined,
    verifiedById: undefined,
    verifiedAt: undefined,
  };
  if (existing) Object.assign(existing, entry);
  else app.docs.push(entry);
  await app.save();
  if (isReupload) await audit(req.user, `Document re-uploaded: ${label} (attempt ${entry.reuploads})`, app.appId);
  res.status(201).json(app);
}));

// ---------- Applicant: payments (FR-6), sandbox always succeeds ----------
app.post('/api/applications/pay', own, wrap(async (req, res) => {
  const app = await Application.findOne({ applicant: req.user.id });
  if (!app) return res.status(400).json({ error: 'Create your application first' });
  const type = req.body.type;

  if (type === 'Application') {
    if (hasPaid(app, 'Application')) return res.status(409).json({ error: 'Application fee already paid' });
    app.payments.push({ type, amount: APPLICATION_FEE, reference: makeRef('PAY'), status: 'Success', at: new Date() });
  } else if (type === 'Admission') {
    if (app.status !== 'Approved') return res.status(400).json({ error: 'Admission fee is available after approval' });
    if (hasPaid(app, 'Admission')) return res.status(409).json({ error: 'Admission fee already paid' });
    const c = await Course.findOne({ name: app.course });
    if (!c) return res.status(400).json({ error: 'Course fee schedule not found. Contact the admission office.' });
    app.payments.push({ type, amount: c.fee, reference: makeRef('PAY'), status: 'Success', at: new Date() });
  } else {
    return res.status(400).json({ error: 'Unknown payment type' });
  }
  await app.save();
  res.json(app);
}));

// ---------- Applicant: submit (FR-4.2) ----------
app.post('/api/applications/submit', own, wrap(async (req, res) => {
  const app = await Application.findOne({ applicant: req.user.id });
  if (!app) return res.status(400).json({ error: 'Create your application first' });
  if (app.status !== 'Submitted') return res.status(400).json({ error: 'Application already submitted' });
  const uploaded = REQUIRED_DOCS.every((l) => app.docs.some((d) => d.label === l));
  if (!uploaded) return res.status(400).json({ error: 'Upload all required documents first' });
  if (!hasPaid(app, 'Application')) return res.status(400).json({ error: 'Pay the application fee first' });

  app.status = 'Under Review';
  app.history.push({ status: 'Under Review', at: new Date(), by: app.applicantName, byId: req.user.id });
  await app.save();
  await audit(req.user, 'Application submitted', app.appId);
  await notify(app, 'Submitted', `Application ${app.appId} received and under review.`);
  res.json(app);
}));

// ---------- Applicant: dashboard notifications ----------
app.get('/api/notifications', auth('notifications:own'), wrap(async (req, res) => {
  const list = await Notification.find({ applicantId: req.user.id }).sort({ sentAt: -1 }).limit(50);
  res.json(list);
}));

// ---------- Staff: review (FR-9 to FR-13) ----------
const SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  status: { status: 1, createdAt: -1 },
  course: { course: 1, campus: 1, createdAt: -1 },
  name: { applicantName: 1, createdAt: -1 },
};

// Adds the fee schedule so the officer can record the correct amount (FR-12.1)
async function staffView(app) {
  const c = await Course.findOne({ name: app.course }).select('fee');
  return { ...app.toObject(), feeSchedule: { Application: APPLICATION_FEE, Admission: c?.fee ?? null } };
}

const review = auth('applications:review');

app.get('/api/staff/applications', review, wrap(async (req, res) => {
  const filter = {};
  if (req.query.status) {
    if (!STATUSES.includes(req.query.status)) return res.status(400).json({ error: 'Unknown status' });
    filter.status = req.query.status;
  }
  if (req.query.course) filter.course = String(req.query.course);
  const q = String(req.query.q || '').trim().slice(0, 50);
  if (q) {
    const rx = new RegExp(escapeRx(q), 'i');
    filter.$or = [{ appId: rx }, { applicantName: rx }, { course: rx }]; // FR-10.2
  }
  const range = dateRange(req.query); // FR-10.1 date range on the application date
  if (range) filter.createdAt = range;
  const sort = SORTS[req.query.sort] || SORTS.newest;
  const apps = await Application.find(filter)
    .select('appId applicantName course campus status createdAt updatedAt')
    .sort(sort)
    .limit(1000)
    .lean();
  res.json(apps);
}));

app.get('/api/staff/applications/:id', review, wrap(async (req, res) => {
  const app = await Application.findById(req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });
  res.json(await staffView(app));
}));

// Serve an uploaded file to staff only
app.get('/api/staff/applications/:id/docs/:index/file', review, wrap(async (req, res) => {
  const app = await Application.findById(req.params.id);
  const doc = app?.docs[Number(req.params.index)];
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  res.download(path.join(UPLOAD_DIR, path.basename(doc.fileName)), doc.originalName);
}));

app.post('/api/staff/applications/:id/docs/:index/review', auth('documents:verify'), wrap(async (req, res) => {
  const { decision, reason = '' } = req.body; // 'Verified' or 'Rejected'
  if (!['Verified', 'Rejected'].includes(decision)) return res.status(400).json({ error: 'Invalid decision' });
  const why = String(reason).trim();
  if (decision === 'Rejected' && !why) {
    return res.status(400).json({ error: 'A reason is required to reject a document' }); // FR-11.3
  }
  if (why.length > 200) return res.status(400).json({ error: 'Reason must be 200 characters or fewer' });
  const app = await Application.findById(req.params.id);
  const doc = app?.docs[Number(req.params.index)];
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (app.status !== 'Under Review') return res.status(400).json({ error: 'Application is not under review' });

  doc.status = decision;
  doc.reason = decision === 'Rejected' ? why : '';
  doc.verifiedBy = req.user.name;
  doc.verifiedById = req.user.id;
  doc.verifiedAt = new Date();
  await app.save();
  await audit(req.user, `Document ${decision.toLowerCase()}: ${doc.label}`, app.appId);
  if (decision === 'Rejected') {
    await notify(app, 'Document rejected', `${app.appId}: ${doc.label} rejected. Reason: ${doc.reason}. Please re-upload.`);
  }
  res.json(await staffView(app));
}));

// FR-12: record fee status (Pending / Paid) with amount, Recorded By and timestamp
app.post('/api/staff/applications/:id/fee', auth('fees:record'), wrap(async (req, res) => {
  const { type, status } = req.body;
  if (!FEE_TYPES.includes(type)) return res.status(400).json({ error: 'Unknown fee type' });
  if (!['Pending', 'Paid'].includes(status)) return res.status(400).json({ error: 'Fee status must be Pending or Paid' });
  const app = await Application.findById(req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });

  if (type === 'Application' && app.status !== 'Under Review') {
    return res.status(400).json({ error: 'The application fee can be recorded only while the application is Under Review' });
  }
  if (type === 'Admission' && app.status !== 'Approved') {
    return res.status(400).json({ error: 'The admission fee can be recorded only after approval' });
  }
  let expected = APPLICATION_FEE;
  if (type === 'Admission') {
    const c = await Course.findOne({ name: app.course }).select('fee');
    if (!c) return res.status(400).json({ error: 'Course fee schedule not found' });
    expected = c.fee;
  }
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount !== expected) {
    return res.status(400).json({ error: `Amount must match the fee schedule (Rs. ${expected})` });
  }
  if (status === 'Paid' && !hasPaid(app, type)) { // IR-5: never mark paid without a successful payment
    return res.status(400).json({ error: `No successful ${type.toLowerCase()} fee payment was found` });
  }

  app.feeRecords.push({ type, status, amount, recordedBy: req.user.name, recordedById: req.user.id, recordedAt: new Date() });
  if (type === 'Application') {
    app.feeVerified = status === 'Paid';
    app.feeVerifiedBy = status === 'Paid' ? req.user.name : undefined;
  }
  await app.save();
  await audit(req.user, `Fee recorded: ${type} ${status} (Rs. ${amount})`, app.appId);
  res.json(await staffView(app));
}));

app.post('/api/staff/applications/:id/decision', auth('applications:decide'), wrap(async (req, res) => {
  const { decision, reason = '' } = req.body; // 'Approved' or 'Rejected'
  if (!['Approved', 'Rejected'].includes(decision)) return res.status(400).json({ error: 'Invalid decision' });
  const why = String(reason).trim();
  const app = await Application.findById(req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });
  if (app.status !== 'Under Review') return res.status(400).json({ error: 'Application is not under review' });

  if (decision === 'Approved') {
    if (!allDocsVerified(app)) return res.status(400).json({ error: 'Verify all documents before approving' });
    if (!app.feeVerified) return res.status(400).json({ error: 'Record the application fee as Paid before approving' });
  } else if (!why) {
    return res.status(400).json({ error: 'A reason is required to reject an application' });
  }

  app.status = decision;
  app.decisionReason = decision === 'Rejected' ? why : '';
  app.history.push({ status: decision, at: new Date(), by: req.user.name, byId: req.user.id });
  await app.save();
  await audit(req.user, `Application ${decision.toLowerCase()}`, app.appId);
  const outcome = decision === 'Approved'
    ? `Application ${app.appId} for ${app.course} (${app.campus}) has been approved. Please pay the admission fee from your dashboard.`
    : `Application ${app.appId} for ${app.course} (${app.campus}) has been rejected. Reason: ${app.decisionReason}`;
  await notify(app, decision, outcome); // FR-14.2
  res.json(await staffView(app));
}));

// ---------- Admin: courses (FR-17) ----------
function parseCourse(body) {
  const name = String(body.name ?? '').trim();
  const campuses = [...new Set((Array.isArray(body.campuses) ? body.campuses : [])
    .map((c) => String(c).trim()).filter(Boolean))];
  const minPercent = Number(body.minPercent);
  const fee = Number(body.fee);
  if (!name || name.length > 100) throw new HttpError(400, 'Course name is required (up to 100 characters)');
  if (!campuses.length) throw new HttpError(400, 'Add at least one campus');
  if (campuses.some((c) => c.length > 100)) throw new HttpError(400, 'Campus names must be 100 characters or fewer');
  if (!Number.isFinite(minPercent) || minPercent < 0 || minPercent > 100) {
    throw new HttpError(400, 'Minimum qualifying % must be between 0 and 100');
  }
  if (!Number.isFinite(fee) || fee < 0 || fee > 9999999999) throw new HttpError(400, 'Enter a valid fee amount');
  return { name, campuses, minPercent, fee, active: body.active === undefined ? true : !!body.active };
}

// Course names are unique (case-insensitive). Since a course lists its campuses, a name can
// never repeat within a campus (FR-17.1 "unique per campus").
async function assertUniqueCourse(name, exceptId) {
  const clash = await Course.findOne({ name: new RegExp(`^${escapeRx(name)}$`, 'i'), _id: { $ne: exceptId } });
  if (clash) throw new HttpError(409, `A course named "${clash.name}" already exists`);
}

const manageCourses = auth('courses:manage');

app.get('/api/admin/courses', manageCourses, wrap(async (req, res) => {
  res.json(await Course.find().sort({ name: 1 }));
}));

app.post('/api/admin/courses', manageCourses, wrap(async (req, res) => {
  const data = parseCourse(req.body);
  await assertUniqueCourse(data.name);
  const course = await Course.create(data);
  await audit(req.user, 'Course created', course.name);
  res.status(201).json(course);
}));

app.put('/api/admin/courses/:id', manageCourses, wrap(async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  const data = parseCourse(req.body);
  await assertUniqueCourse(data.name, course._id);
  // Applications store the course name, so renaming one in use would break fee lookups
  if (data.name !== course.name && (await Application.exists({ course: course.name }))) {
    return res.status(409).json({ error: 'This course already has applications and cannot be renamed. Deactivate it and add a new one instead.' });
  }
  const before = course.active;
  Object.assign(course, data);
  await course.save();
  const action = before !== course.active ? (course.active ? 'Course activated' : 'Course deactivated') : 'Course updated';
  await audit(req.user, action, course.name);
  res.json(course);
}));

// ---------- Admin: staff accounts (FR-18) ----------
const manageStaff = auth('staff:manage');
const staffJson = (u) => ({ _id: u._id, name: u.name, email: u.email, role: u.role, active: u.active });

app.get('/api/admin/staff', manageStaff, wrap(async (req, res) => {
  const list = await User.find({ role: { $in: ['officer', 'admin'] } }).select('name email role active').sort({ name: 1 });
  res.json(list.map(staffJson));
}));

app.post('/api/admin/staff', manageStaff, wrap(async (req, res) => {
  const { name = '', email = '', password = '', role } = req.body;
  if (!['officer', 'admin'].includes(role)) return res.status(400).json({ error: 'Role must be officer or admin' });
  if (!NAME_RX.test(name.trim()) || name.trim().length > 100) return res.status(400).json({ error: 'Enter a valid name (letters and spaces)' });
  if (!EMAIL_RX.test(email.trim()) || email.trim().length > 100) return res.status(400).json({ error: 'Enter a valid email' });
  if (!PASSWORD_RX.test(password)) {
    return res.status(400).json({ error: 'Password: 8-20 characters with 1 uppercase letter, 1 number and 1 symbol' });
  }
  if (await User.exists({ email: normEmail(email) })) return res.status(409).json({ error: 'Email already in use' });
  const user = await User.create({
    name: name.trim(),
    email: normEmail(email),
    passwordHash: await bcrypt.hash(password, 10),
    role,
    verified: true,
  });
  await audit(req.user, `Staff created (${role})`, user.email);
  res.status(201).json(staffJson(user));
}));

// Edit name / role / account status
app.patch('/api/admin/staff/:id', manageStaff, wrap(async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot change your own account' });
  const user = await User.findOne({ _id: req.params.id, role: { $in: ['officer', 'admin'] } });
  if (!user) return res.status(404).json({ error: 'Staff account not found' });
  const changes = [];
  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!NAME_RX.test(name) || name.length > 100) return res.status(400).json({ error: 'Enter a valid name (letters and spaces)' });
    if (name !== user.name) { user.name = name; changes.push('name'); }
  }
  if (req.body.role !== undefined) {
    if (!['officer', 'admin'].includes(req.body.role)) return res.status(400).json({ error: 'Role must be officer or admin' });
    if (req.body.role !== user.role) { user.role = req.body.role; changes.push(`role → ${user.role}`); }
  }
  let statusChange = '';
  if (req.body.active !== undefined && !!req.body.active !== user.active) {
    user.active = !!req.body.active;
    statusChange = user.active ? 'Staff activated' : 'Staff deactivated';
  }
  await user.save();
  if (!user.active) await Session.deleteMany({ userId: user._id }); // FR-8.1: deactivated staff are signed out at once
  if (changes.length) await audit(req.user, `Staff updated (${changes.join(', ')})`, user.email);
  if (statusChange) await audit(req.user, statusChange, user.email);
  res.json(staffJson(user));
}));

// ---------- Admin: audit log (FR-15), read only ----------
app.get('/api/admin/audit', auth('audit:view'), wrap(async (req, res) => {
  const filter = {};
  const range = dateRange(req.query);
  if (range) filter.at = range;
  const q = String(req.query.q || '').trim().slice(0, 50);
  if (q) {
    const rx = new RegExp(escapeRx(q), 'i');
    filter.$or = [{ userName: rx }, { action: rx }, { target: rx }, { logId: rx }];
  }
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  res.json(await AuditLog.find(filter).sort({ at: -1 }).limit(limit));
}));

// ---------- Admin: notification log (FR-14) ----------
app.get('/api/admin/notifications', auth('notifications:view'), wrap(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.deliveryStatus = req.query.status === 'Failed' ? 'Failed' : 'Sent';
  const range = dateRange(req.query);
  if (range) filter.sentAt = range;
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  res.json(await Notification.find(filter).sort({ sentAt: -1 }).limit(limit));
}));

// ---------- Admin: reports (FR-19) ----------
const STATUS_LABEL = { Submitted: 'Draft', 'Under Review': 'Under Review', Approved: 'Approved', Rejected: 'Rejected' };
const REPORT_TITLES = { course: 'Applications by Course', status: 'Applications by Status', date: 'Applications by Date' };

async function buildReport(type, query) {
  if (!REPORT_TITLES[type]) throw new HttpError(400, 'Report type must be course, status or date');
  const range = dateRange(query);
  const apps = await Application.find(range ? { createdAt: range } : {}).select('course campus status createdAt').lean();
  const statusCols = STATUSES.map((s) => STATUS_LABEL[s]);
  const emptyCounts = () => Object.fromEntries(STATUSES.map((s) => [s, 0]));
  let columns;
  let rows;

  if (type === 'status') {
    const counts = emptyCounts();
    apps.forEach((a) => { counts[a.status] = (counts[a.status] || 0) + 1; });
    columns = ['Status', 'Applications', 'Share (%)'];
    rows = STATUSES.map((s) => [STATUS_LABEL[s], counts[s],
      apps.length ? Math.round((counts[s] / apps.length) * 1000) / 10 : 0]);
  } else {
    const groups = new Map();
    for (const a of apps) {
      const key = type === 'course' ? `${a.course}\u0000${a.campus}` : new Date(a.createdAt).toLocaleDateString('en-CA');
      if (!groups.has(key)) groups.set(key, emptyCounts());
      groups.get(key)[a.status] += 1;
    }
    const keys = [...groups.keys()].sort();
    const total = (c) => STATUSES.reduce((n, s) => n + c[s], 0);
    if (type === 'course') {
      columns = ['Course', 'Campus', ...statusCols, 'Total'];
      rows = keys.map((k) => [...k.split('\u0000'), ...STATUSES.map((s) => groups.get(k)[s]), total(groups.get(k))]);
    } else {
      columns = ['Date', ...statusCols, 'Total'];
      rows = keys.map((k) => [k, ...STATUSES.map((s) => groups.get(k)[s]), total(groups.get(k))]);
    }
  }
  return {
    type, title: REPORT_TITLES[type], columns, rows, total: apps.length,
    from: query.from || '', to: query.to || '', generatedAt: new Date().toISOString(),
  };
}

const csvEscape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const toCsv = (header, rows) => '﻿' + [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');

function sendReportPdf(res, report) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  res.type('application/pdf').attachment(`report-${report.type}.pdf`);
  doc.pipe(res);

  const left = 40;
  const width = doc.page.width - 80;
  const weights = report.columns.map((c, i) => (i === 0 && report.type === 'course' ? 2.4 : i < 2 && report.type === 'course' ? 1.6 : 1));
  const unit = width / weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => w * unit);
  const rowH = 20;
  let y;

  const drawRow = (cells, bold) => {
    if (y + rowH > doc.page.height - 50) { doc.addPage(); y = 40; drawRow(report.columns, true); }
    if (bold) doc.rect(left, y, width, rowH).fill('#eef1f6');
    let x = left;
    cells.forEach((c, i) => {
      doc.fillColor('#111').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
        .text(String(c), x + 4, y + 6, { width: widths[i] - 8, height: 11, ellipsis: true, lineBreak: false });
      x += widths[i];
    });
    doc.moveTo(left, y + rowH).lineTo(left + width, y + rowH).lineWidth(0.5).strokeColor('#c8ccd4').stroke();
    y += rowH;
  };

  doc.fillColor('#1b2f5e').font('Helvetica-Bold').fontSize(15).text('IEM Admission Management System', left, 40);
  doc.fillColor('#111').fontSize(12).text(report.title);
  const rangeText = report.from || report.to ? `${report.from || 'start'} to ${report.to || 'today'}` : 'All dates';
  doc.fillColor('#555').font('Helvetica').fontSize(9)
    .text(`Date range: ${rangeText}    Total applications: ${report.total}    Generated: ${new Date(report.generatedAt).toLocaleString()}`);
  y = doc.y + 12;
  drawRow(report.columns, true);
  report.rows.forEach((r) => drawRow(r, false));
  if (!report.rows.length) drawRow(['No applications in this range'], false);
  doc.end();
}

app.get('/api/admin/reports', auth('reports:view'), wrap(async (req, res) => {
  const report = await buildReport(String(req.query.type || 'status'), req.query);
  if (req.query.format === 'csv') {
    res.type('text/csv').attachment(`report-${report.type}.csv`)
      .send(toCsv(report.columns, [...report.rows, ['Total applications', report.total]]));
    return;
  }
  if (req.query.format === 'pdf') return sendReportPdf(res, report);
  res.json(report);
}));

// Detailed list export (CSV) using the same date-range filter
app.get('/api/admin/reports/applications', auth('reports:view'), wrap(async (req, res) => {
  const range = dateRange(req.query);
  const apps = await Application.find(range ? { createdAt: range } : {}).sort({ createdAt: -1 });
  const header = ['App ID', 'Applicant', 'Course', 'Campus', 'Marks', 'Status', 'Application Fee', 'Created'];
  const rows = apps.map((a) => [a.appId, a.applicantName, a.course, a.campus, a.marks, STATUS_LABEL[a.status] || a.status,
    a.feeVerified ? 'Paid (verified)' : hasPaid(a, 'Application') ? 'Paid (not verified)' : 'Pending',
    a.createdAt?.toISOString()]);
  res.type('text/csv').attachment('applications.csv').send(toCsv(header, rows));
}));

// ---------- Errors and startup ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: 'Upload failed: ' + err.message });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

async function seed() {
  if (!(await Course.exists({}))) await Course.insertMany(COURSE_SEED);
  if (!(await User.exists({ role: 'admin' }))) {
    if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
      console.warn('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env to create the first admin');
      return;
    }
    await User.create({
      name: 'System Admin',
      email: normEmail(process.env.ADMIN_EMAIL),
      passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD, 10),
      role: 'admin',
      verified: true,
    });
    console.log('First admin account created');
  }
}

const PORT = process.env.PORT || 5000;
mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    await seed();
    app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('Database connection failed:', err.message);
    process.exit(1);
  });
