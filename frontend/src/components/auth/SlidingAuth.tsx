'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { errMsg } from '@/services/api';

interface SlidingAuthProps {
  initialMode?: 'login' | 'register';
}

export default function SlidingAuth({ initialMode = 'login' }: SlidingAuthProps) {
  const { login, register } = useAuth();
  const router = useRouter();

  // Active state: true = register (Sign Up), false = login (Sign In)
  const [isActive, setIsActive] = useState<boolean>(initialMode === 'register');

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  // Register form state
  const [regFirstName, setRegFirstName] = useState('');
  const [regLastName, setRegLastName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(true);

  // Shared UI state
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [forgotModal, setForgotModal] = useState(false);

  // Sync mode with props if route changes
  useEffect(() => {
    const t = window.setTimeout(() => {
      setIsActive(initialMode === 'register');
    }, 0);
    return () => window.clearTimeout(t);
  }, [initialMode]);

  const homeForRole = (role: string) => {
    if (role === 'admin') return '/admin';
    if (role === 'driver') return '/driver';
    return '/user';
  };

  const handleSwitchToRegister = () => {
    setIsActive(true);
    setError('');
    window.history.replaceState(null, '', '/register');
  };

  const handleSwitchToLogin = () => {
    setIsActive(false);
    setError('');
    window.history.replaceState(null, '', '/login');
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const user = await login(loginEmail, loginPassword);
      router.replace(homeForRole(user.role));
    } catch (err) {
      setError(errMsg(err) || 'Invalid email or password');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!agreeTerms) {
      setError('Please accept the terms & conditions to proceed');
      return;
    }

    const fullName = `${regFirstName.trim()} ${regLastName.trim()}`.trim();
    if (!fullName) {
      setError('Please provide your name');
      return;
    }

    setSubmitting(true);
    try {
      await register({
        full_name: fullName,
        email: regEmail,
        phone: regPhone.trim() || undefined,
        password: regPassword,
      });
      router.replace('/user');
    } catch (err) {
      setError(errMsg(err) || 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  const fillDemo = (role: 'admin' | 'driver' | 'passenger') => {
    setIsActive(false);
    setError('');
    window.history.replaceState(null, '', '/login');
    if (role === 'admin') {
      setLoginEmail('admin@busgo.test');
      setLoginPassword('admin123');
    } else if (role === 'driver') {
      setLoginEmail('driver1@busgo.test');
      setLoginPassword('driver123');
    } else {
      setLoginEmail('passenger1@busgo.test');
      setLoginPassword('pass123');
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/?search=${encodeURIComponent(searchQuery.trim())}`);
    } else {
      router.push('/');
    }
  };

  return (
    <div className="auth-wrapper">
      {/* Blurred synthwave background backdrop */}
      <div className="auth-bg" />

      {/* Top Navbar */}
      <header className="auth-header">
        <nav className="auth-navbar">
          <Link href="/" className="active">Home</Link>
          <Link href="/#routes">Routes</Link>
          <Link href="/#schedule">Schedule</Link>
          <Link href="/#about">About</Link>
          <Link href="/#contact">Contact</Link>
          <Link href="/#help">Help</Link>
        </nav>

        <form onSubmit={handleSearchSubmit} className="auth-search-bar">
          <input
            type="text"
            placeholder="Search routes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button type="submit" title="Search">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
        </form>
      </header>

      {/* Center Sliding Container */}
      <div className="auth-container">
        {/* Left Hero Card */}
        <div className="auth-item">
          <Link href="/" className="auth-logo">
            <svg className="w-8 h-8 text-pink-500 fill-current" viewBox="0 0 24 24">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            <span>BusGo</span> Transit
          </Link>

          <div className="auth-text-item">
            <h2>Welcome!<br />To BusGo</h2>
            <p>
              Kenya&apos;s intelligent intercity bus network. Seamless booking, instant dynamic seat chains, and live MPesa checkout.
            </p>

            {/* Quick Demo Credentials for Fast Testing */}
            <div className="mt-4">
              <span className="text-[11px] uppercase tracking-wider text-pink-300 font-bold block mb-1.5">
                Quick Demo Auto-Fill:
              </span>
              <div className="auth-demo-chips">
                <button
                  type="button"
                  onClick={() => fillDemo('passenger')}
                  className="auth-demo-chip"
                  title="Passenger Account"
                >
                  ⚡ Passenger
                </button>
                <button
                  type="button"
                  onClick={() => fillDemo('driver')}
                  className="auth-demo-chip"
                  title="Driver Account"
                >
                  🚌 Driver
                </button>
                <button
                  type="button"
                  onClick={() => fillDemo('admin')}
                  className="auth-demo-chip"
                  title="Admin Account"
                >
                  🛡️ Admin
                </button>
              </div>
            </div>
          </div>

          <div className="auth-social-icons">
            <a href="https://facebook.com" target="_blank" rel="noreferrer" title="Facebook">
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
            </a>
            <a href="https://twitter.com" target="_blank" rel="noreferrer" title="Twitter / X">
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            <a href="https://youtube.com" target="_blank" rel="noreferrer" title="YouTube">
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
            </a>
            <a href="https://instagram.com" target="_blank" rel="noreferrer" title="Instagram">
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
              </svg>
            </a>
            <a href="https://linkedin.com" target="_blank" rel="noreferrer" title="LinkedIn">
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
              </svg>
            </a>
          </div>
        </div>

        {/* Right Section: Sliding Form Box Container */}
        <div className={`login-section ${isActive ? 'active' : ''}`}>
          {/* 1. SIGN IN FORM BOX */}
          <div className="form-box login">
            <form onSubmit={handleLoginSubmit} className="w-full flex flex-col items-center">
              <h2>Sign In</h2>

              {error && !isActive && (
                <div className="auth-error-banner">{error}</div>
              )}

              {/* Email Input */}
              <div className={`input-box ${loginEmail ? 'has-val' : ''}`}>
                <span className="icon">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </span>
                <input
                  type="email"
                  required
                  placeholder=" "
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  disabled={submitting}
                />
                <label>Email</label>
              </div>

              {/* Password Input */}
              <div className={`input-box ${loginPassword ? 'has-val' : ''}`}>
                <span className="icon">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </span>
                <input
                  type="password"
                  required
                  placeholder=" "
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  disabled={submitting}
                />
                <label>Password</label>
              </div>

              {/* Remember Me & Forgot Password */}
              <div className="remember-password">
                <label>
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  Remember Me
                </label>
                <a
                  href="#forgot"
                  onClick={(e) => {
                    e.preventDefault();
                    setForgotModal(true);
                  }}
                >
                  Forgot Password?
                </a>
              </div>

              {/* Login Button */}
              <button
                type="submit"
                disabled={submitting}
                className="auth-btn"
              >
                {submitting ? 'Signing In…' : 'Sign In'}
              </button>

              {/* Transition Switch to Register */}
              <div className="create-account">
                <p>
                  Create A New Account?{' '}
                  <button
                    type="button"
                    onClick={handleSwitchToRegister}
                    className="register-link font-bold underline"
                  >
                    Sign Up
                  </button>
                </p>
              </div>
            </form>
          </div>

          {/* 2. SIGN UP FORM BOX */}
          <div className="form-box register">
            <form onSubmit={handleRegisterSubmit} className="w-full flex flex-col items-center">
              <h2>Sign Up</h2>

              {error && isActive && (
                <div className="auth-error-banner">{error}</div>
              )}

              {/* First Name & Last Name (Side-by-side or stacked cleanly) */}
              <div className="flex gap-3 w-[320px] max-w-full">
                <div className={`input-box flex-1 !my-2 ${regFirstName ? 'has-val' : ''}`}>
                  <span className="icon">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    required
                    placeholder=" "
                    value={regFirstName}
                    onChange={(e) => setRegFirstName(e.target.value)}
                    disabled={submitting}
                  />
                  <label>First Name</label>
                </div>

                <div className={`input-box flex-1 !my-2 ${regLastName ? 'has-val' : ''}`}>
                  <span className="icon">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    required
                    placeholder=" "
                    value={regLastName}
                    onChange={(e) => setRegLastName(e.target.value)}
                    disabled={submitting}
                  />
                  <label>Last Name</label>
                </div>
              </div>

              {/* Email Input */}
              <div className={`input-box !my-2 ${regEmail ? 'has-val' : ''}`}>
                <span className="icon">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </span>
                <input
                  type="email"
                  required
                  placeholder=" "
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  disabled={submitting}
                />
                <label>Email</label>
              </div>

              {/* Phone Input (Optional) */}
              <div className={`input-box !my-2 ${regPhone ? 'has-val' : ''}`}>
                <span className="icon">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                </span>
                <input
                  type="tel"
                  placeholder=" "
                  value={regPhone}
                  onChange={(e) => setRegPhone(e.target.value)}
                  disabled={submitting}
                />
                <label>Phone (2547...)</label>
              </div>

              {/* Password Input */}
              <div className={`input-box !my-2 ${regPassword ? 'has-val' : ''}`}>
                <span className="icon">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </span>
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder=" "
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  disabled={submitting}
                />
                <label>Password</label>
              </div>

              {/* Terms & Conditions Checkbox */}
              <div className="remember-password !my-1">
                <label className="text-xs">
                  <input
                    type="checkbox"
                    checked={agreeTerms}
                    onChange={(e) => setAgreeTerms(e.target.checked)}
                  />
                  I agree with terms &amp; privacy policy
                </label>
              </div>

              {/* Sign Up Button */}
              <button
                type="submit"
                disabled={submitting}
                className="auth-btn !mt-2"
              >
                {submitting ? 'Creating Account…' : 'Sign Up'}
              </button>

              {/* Transition Switch to Login */}
              <div className="create-account !mt-3">
                <p>
                  Already Have An Account?{' '}
                  <button
                    type="button"
                    onClick={handleSwitchToLogin}
                    className="login-link font-bold underline"
                  >
                    Sign In
                  </button>
                </p>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* Forgot Password Modal */}
      {forgotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl max-w-sm w-full text-center shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-2">Password Reset</h3>
            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              For demo safety or self-hosted environments, use the built-in demo credentials or contact the BusGo transit dispatcher.
            </p>
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-left text-xs font-mono space-y-1 mb-5">
              <p className="text-pink-400 font-bold font-sans">Default Accounts:</p>
              <p className="text-slate-300">admin@busgo.test / admin123</p>
              <p className="text-slate-300">driver1@busgo.test / driver123</p>
              <p className="text-slate-300">passenger1@busgo.test / pass123</p>
            </div>
            <button
              onClick={() => setForgotModal(false)}
              className="w-full py-2.5 bg-pink-600 hover:bg-pink-500 text-white font-bold rounded-xl text-sm transition-all"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
