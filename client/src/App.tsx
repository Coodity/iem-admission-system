import type { ReactElement } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import RouteGuard from './RouteGuard';
import Login from './pages/Login';
import Register from './pages/Register';
import VerifyOtp from './pages/VerifyOtp';
import ForgotPassword from './pages/ForgotPassword';
import Dashboard from './pages/Dashboard';
import ApplicationForm from './pages/ApplicationForm';
import OfficerReview from './pages/OfficerReview';
import Courses from './pages/admin/Courses';
import Staff from './pages/admin/Staff';
import Reports from './pages/admin/Reports';
import Notifications from './pages/admin/Notifications';
import AuditLog from './pages/admin/AuditLog';

const admin = (el: ReactElement) => <RouteGuard roles={['admin']}>{el}</RouteGuard>;

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/verify" element={<VerifyOtp />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/dashboard" element={<RouteGuard roles={['applicant']}><Dashboard /></RouteGuard>} />
          <Route path="/apply" element={<RouteGuard roles={['applicant']}><ApplicationForm /></RouteGuard>} />
          <Route path="/officer" element={<RouteGuard roles={['officer', 'admin']}><OfficerReview /></RouteGuard>} />
          <Route path="/admin" element={<Navigate to="/admin/reports" replace />} />
          <Route path="/admin/courses" element={admin(<Courses />)} />
          <Route path="/admin/staff" element={admin(<Staff />)} />
          <Route path="/admin/reports" element={admin(<Reports />)} />
          <Route path="/admin/notifications" element={admin(<Notifications />)} />
          <Route path="/admin/audit" element={admin(<AuditLog />)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
