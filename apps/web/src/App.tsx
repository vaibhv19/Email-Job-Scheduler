import React, { useState, useEffect, useCallback } from 'react';

interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  avatar_url?: string | null;
  google_subject?: string;
}

interface Sender {
  id: string;
  email: string;
  display_name: string;
  min_send_interval_ms: number;
  max_emails_per_hour: number;
}

interface ScheduledEmail {
  id: string;
  recipient_email: string;
  subject: string;
  scheduled_at: string;
  status: string;
  bullmq_job_id?: string;
}

interface SentEmail {
  id: string;
  recipient_email: string;
  subject: string;
  status: string;
  sent_at?: string;
  preview_url?: string;
  last_error?: { message?: string } | null;
}

export const App: React.FC = () => {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Dashboard Data State
  const [senders, setSenders] = useState<Sender[]>([]);
  const [scheduledEmails, setScheduledEmails] = useState<ScheduledEmail[]>([]);
  const [sentEmails, setSentEmails] = useState<SentEmail[]>([]);
  const [activeTab, setActiveTab] = useState<'compose' | 'scheduled' | 'sent'>('compose');

  // Compose Form State
  const [selectedSenderId, setSelectedSenderId] = useState<string>('');
  const [recipientEmail, setRecipientEmail] = useState<string>('');
  const [subject, setSubject] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const [scheduledDelayMinutes, setScheduledDelayMinutes] = useState<number>(5);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formFeedback, setFormFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Check initial authentication state
  const checkAuth = useCallback(async () => {
    setIsLoadingAuth(true);
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        const data = (await res.json()) as { user: AuthenticatedUser };
        setUser(data.user);
        setAuthError(null);
      } else {
        setUser(null);
      }
    } catch (err) {
      console.error('Failed to verify session:', err);
      setUser(null);
    } finally {
      setIsLoadingAuth(false);
    }
  }, []);

  // Fetch Senders and Emails once authenticated
  const loadDashboardData = useCallback(async () => {
    if (!user) return;

    try {
      // 1. Fetch Senders
      const sendersRes = await fetch('/api/senders', { credentials: 'include' });
      if (sendersRes.ok) {
        const sendersData = (await sendersRes.json()) as { senders: Sender[] };
        setSenders(sendersData.senders || []);
        if (sendersData.senders && sendersData.senders.length > 0 && !selectedSenderId) {
          setSelectedSenderId(sendersData.senders[0].id);
        }
      }

      // 2. Fetch Scheduled Emails
      const scheduledRes = await fetch('/api/emails/scheduled?limit=50', { credentials: 'include' });
      if (scheduledRes.ok) {
        const scheduledData = (await scheduledRes.json()) as { data: ScheduledEmail[] };
        setScheduledEmails(scheduledData.data || []);
      }

      // 3. Fetch Sent Emails
      const sentRes = await fetch('/api/emails/sent?limit=50', { credentials: 'include' });
      if (sentRes.ok) {
        const sentData = (await sentRes.json()) as { data: SentEmail[] };
        setSentEmails(sentData.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    }
  }, [user, selectedSenderId]);

  useEffect(() => {
    // Check for callback error in URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const errorParam = urlParams.get('error');
    if (errorParam) {
      setAuthError(decodeURIComponent(errorParam));
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (user) {
      loadDashboardData();
    }
  }, [user, loadDashboardData]);

  // Handle Google OAuth Sign In
  const handleGoogleSignIn = () => {
    // Genuine browser navigation to real Google OAuth endpoint
    window.location.href = '/api/auth/google';
  };

  // Handle Logout
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
      setUser(null);
      setSenders([]);
      setScheduledEmails([]);
      setSentEmails([]);
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  // Handle Schedule Email Submit
  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSenderId) {
      setFormFeedback({ type: 'error', message: 'Please select a valid sender.' });
      return;
    }

    setIsSubmitting(true);
    setFormFeedback(null);

    const scheduledDate = new Date(Date.now() + scheduledDelayMinutes * 60 * 1000);

    try {
      const res = await fetch('/api/emails/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          sender_id: selectedSenderId,
          recipient_email: recipientEmail,
          subject,
          body,
          scheduled_at: scheduledDate.toISOString(),
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setFormFeedback({
          type: 'success',
          message: `Email scheduled successfully for ${scheduledDate.toLocaleTimeString()}! BullMQ Job ID: ${data.data?.bullmq_job_id}`,
        });
        setRecipientEmail('');
        setSubject('');
        setBody('');
        loadDashboardData();
      } else {
        setFormFeedback({
          type: 'error',
          message: data.error?.message || 'Failed to schedule email.',
        });
      }
    } catch {
      setFormFeedback({
        type: 'error',
        message: 'Network error communicating with scheduler API.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoadingAuth) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm font-medium text-slate-400">Verifying authenticated session...</span>
        </div>
      </div>
    );
  }

  // ============================================================================
  // UNAUTHENTICATED STATE: Genuine Sign In Screen
  // ============================================================================
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between">
        <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/30">
                R
              </div>
              <span className="font-semibold text-lg tracking-tight">ReachInbox</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                Email Scheduler
              </span>
            </div>
            <div className="flex items-center space-x-2 text-xs text-slate-400">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
              <span>Authentication Required</span>
            </div>
          </div>
        </header>

        <main className="max-w-md mx-auto px-6 py-16 w-full">
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-8 shadow-2xl backdrop-blur-sm text-center">
            <div className="w-14 h-14 bg-indigo-600/10 border border-indigo-500/30 rounded-2xl flex items-center justify-center mx-auto mb-6 text-indigo-400 shadow-inner">
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-white mb-2">Welcome to ReachInbox</h1>
            <p className="text-sm text-slate-400 mb-6">
              Sign in with your Google account to access your personal scheduled email dashboard.
            </p>

            {authError && (
              <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs text-left">
                <strong>Authentication Notice:</strong> {authError}
              </div>
            )}

            {/* Genuine Google OAuth Button */}
            <button
              onClick={handleGoogleSignIn}
              id="google-signin-btn"
              className="w-full flex items-center justify-center space-x-3 py-3 px-4 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-medium text-sm transition-all shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-900 cursor-pointer"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Sign in with Google</span>
            </button>

            <div className="mt-6 pt-6 border-t border-slate-800 text-xs text-slate-500 flex flex-col space-y-1">
              <span>● Protected by Google OAuth 2.0 & PKCE</span>
              <span>● Secure HTTP-only Session Cookies</span>
            </div>
          </div>
        </main>

        <footer className="border-t border-slate-800/80 py-6 text-center text-xs text-slate-500">
          ReachInbox.ai Software Development Intern Assignment &copy; {new Date().getFullYear()}
        </footer>
      </div>
    );
  }

  // ============================================================================
  // AUTHENTICATED STATE: Genuine Dashboard
  // ============================================================================
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md px-6 py-4 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/30">
              R
            </div>
            <span className="font-semibold text-lg tracking-tight">ReachInbox</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Authenticated
            </span>
          </div>

          {/* User Profile & Sign Out */}
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-3 bg-slate-800/60 border border-slate-700/60 rounded-full py-1.5 px-3">
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.name}
                  className="w-6 h-6 rounded-full border border-slate-600"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-bold">
                  {user.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="text-left hidden sm:block">
                <div className="text-xs font-medium text-slate-200">{user.name}</div>
                <div className="text-[10px] text-slate-400 truncate max-w-[140px]">{user.email}</div>
              </div>
            </div>

            <button
              onClick={handleLogout}
              className="text-xs py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Main Dashboard */}
      <main className="max-w-7xl mx-auto px-6 py-8 flex-1 w-full space-y-6">
        {/* Navigation Tabs */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setActiveTab('compose')}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition cursor-pointer ${
                activeTab === 'compose'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                  : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              ✉️ Compose & Schedule
            </button>
            <button
              onClick={() => setActiveTab('scheduled')}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition cursor-pointer ${
                activeTab === 'scheduled'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                  : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              ⏱️ Scheduled Outbox ({scheduledEmails.length})
            </button>
            <button
              onClick={() => setActiveTab('sent')}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition cursor-pointer ${
                activeTab === 'sent'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                  : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              ✅ Sent Emails ({sentEmails.length})
            </button>
          </div>

          <button
            onClick={loadDashboardData}
            className="text-xs flex items-center space-x-1.5 py-1.5 px-3 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700/60 cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Refresh</span>
          </button>
        </div>

        {/* User Identity & Security Pill */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between text-xs text-slate-400 gap-2">
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-slate-300">Identity Key (Google sub):</span>
            <span className="font-mono bg-slate-800 px-2 py-0.5 rounded text-indigo-300">
              {user.google_subject || 'Verified'}
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-slate-300">Active Send Limit:</span>
            <span className="bg-slate-800 px-2 py-0.5 rounded text-emerald-400">
              50 emails/hour (2.0s min interval)
            </span>
          </div>
        </div>

        {/* TAB 1: COMPOSE & SCHEDULE */}
        {activeTab === 'compose' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-slate-900/40 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <h2 className="text-lg font-semibold text-white mb-4">Schedule New Email</h2>

              {formFeedback && (
                <div
                  className={`mb-4 p-3 rounded-lg text-xs ${
                    formFeedback.type === 'success'
                      ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                      : 'bg-red-500/10 border border-red-500/30 text-red-400'
                  }`}
                >
                  {formFeedback.message}
                </div>
              )}

              <form onSubmit={handleScheduleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Sender Account
                  </label>
                  <select
                    value={selectedSenderId}
                    onChange={(e) => setSelectedSenderId(e.target.value)}
                    required
                    className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {senders.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.display_name} ({s.email}) — max {s.max_emails_per_hour}/hr
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Recipient Email
                  </label>
                  <input
                    type="email"
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    required
                    placeholder="recipient@example.com"
                    className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Subject Line
                  </label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    required
                    placeholder="Enter email subject"
                    className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Email Body
                  </label>
                  <textarea
                    rows={4}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    required
                    placeholder="Write your email body content..."
                    className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  ></textarea>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Dispatch Delay: {scheduledDelayMinutes} minutes from now
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="60"
                    value={scheduledDelayMinutes}
                    onChange={(e) => setScheduledDelayMinutes(parseInt(e.target.value, 10))}
                    className="w-full accent-indigo-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition shadow-lg shadow-indigo-600/30 disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? 'Scheduling with BullMQ...' : 'Schedule Email'}
                </button>
              </form>
            </div>

            {/* Senders Overview Card */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <h2 className="text-lg font-semibold text-white">Your Senders</h2>
              <div className="space-y-3">
                {senders.map((s) => (
                  <div
                    key={s.id}
                    className="p-3 rounded-xl bg-slate-800/50 border border-slate-700/50 text-xs space-y-1"
                  >
                    <div className="font-semibold text-slate-200">{s.display_name}</div>
                    <div className="text-slate-400">{s.email}</div>
                    <div className="text-[10px] text-indigo-400 pt-1">
                      Min interval: {s.min_send_interval_ms}ms | Quota: {s.max_emails_per_hour}/hr
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: SCHEDULED EMAILS */}
        {activeTab === 'scheduled' && (
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-white mb-4">Scheduled Queue Outbox</h2>
            {scheduledEmails.length === 0 ? (
              <p className="text-xs text-slate-500">No pending scheduled emails found in queue.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="border-b border-slate-800 text-slate-400 uppercase">
                    <tr>
                      <th className="py-2 px-3">Recipient</th>
                      <th className="py-2 px-3">Subject</th>
                      <th className="py-2 px-3">Scheduled At</th>
                      <th className="py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {scheduledEmails.map((e) => (
                      <tr key={e.id} className="hover:bg-slate-800/30">
                        <td className="py-2.5 px-3 font-medium text-slate-200">{e.recipient_email}</td>
                        <td className="py-2.5 px-3">{e.subject}</td>
                        <td className="py-2.5 px-3 text-slate-400">
                          {new Date(e.scheduled_at).toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px]">
                            {e.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: SENT EMAILS */}
        {activeTab === 'sent' && (
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-white mb-4">Delivered & Completed Emails</h2>
            {sentEmails.length === 0 ? (
              <p className="text-xs text-slate-500">No sent emails recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="border-b border-slate-800 text-slate-400 uppercase">
                    <tr>
                      <th className="py-2 px-3">Recipient</th>
                      <th className="py-2 px-3">Subject</th>
                      <th className="py-2 px-3">Sent At</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Preview</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {sentEmails.map((e) => (
                      <tr key={e.id} className="hover:bg-slate-800/30">
                        <td className="py-2.5 px-3 font-medium text-slate-200">{e.recipient_email}</td>
                        <td className="py-2.5 px-3">{e.subject}</td>
                        <td className="py-2.5 px-3 text-slate-400">
                          {e.sent_at ? new Date(e.sent_at).toLocaleString() : 'N/A'}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] ${
                              e.status === 'sent'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-red-500/10 text-red-400 border border-red-500/20'
                            }`}
                          >
                            {e.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          {e.preview_url ? (
                            <a
                              href={e.preview_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-indigo-400 hover:text-indigo-300 underline"
                            >
                              View Ethereal Email
                            </a>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-6 text-center text-xs text-slate-500">
        ReachInbox.ai Software Development Intern Assignment &copy; {new Date().getFullYear()}
      </footer>
    </div>
  );
};

export default App;
