import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children, requireOwner = false }) {
  const { session, profile, loading } = useAuth()

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
  if (!session) return <Navigate to="/login" replace />
  if (requireOwner && profile?.role !== 'owner') return <Navigate to="/" replace />

  return children
}
