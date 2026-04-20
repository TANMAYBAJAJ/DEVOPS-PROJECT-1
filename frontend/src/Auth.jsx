import { useState } from 'react';
import api from './api';

export default function Auth({ onLogin }) {
  const [mode, setMode]       = useState('login'); // 'login' | 'register'
  const [form, setForm]       = useState({ username: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'register') {
        await api.post('/users/register', form);
        setMode('login');
        setError('');
        setForm({ ...form, password: '' });
      } else {
        const { data } = await api.post('/users/login', { email: form.email, password: form.password });
        localStorage.setItem('token', data.token);
        onLogin(data.user);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <h1 className="auth-title">⚙️ DevOps Tasks</h1>
        <p className="auth-subtitle">
          {mode === 'login' ? 'Sign in to manage your tasks' : 'Create your account'}
        </p>

        <div className="tabs">
          <button className={`tab ${mode === 'login' ? 'active' : ''}`} onClick={() => { setMode('login'); setError(''); }}>Login</button>
          <button className={`tab ${mode === 'register' ? 'active' : ''}`} onClick={() => { setMode('register'); setError(''); }}>Register</button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="form-group">
              <label>Username</label>
              <input name="username" className="form-control" placeholder="devuser" value={form.username} onChange={handleChange} required />
            </div>
          )}
          <div className="form-group">
            <label>Email</label>
            <input name="email" type="email" className="form-control" placeholder="you@company.com" value={form.email} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input name="password" type="password" className="form-control" placeholder="••••••••" value={form.password} onChange={handleChange} required />
          </div>

          {error && <p style={{ color: 'var(--red)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>{error}</p>}

          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Please wait…' : mode === 'login' ? '🔑 Sign In' : '🚀 Create Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
