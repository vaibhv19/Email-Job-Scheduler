import React, { useState, useEffect, useCallback, useMemo } from 'react';

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

interface EmailItem {
  id: string;
  user_id?: string;
  sender_id?: string;
  recipient_email: string;
  subject: string;
  body?: string;
  status: string;
  scheduled_at: string;
  sent_at?: string | null;
  preview_url?: string | null;
  bullmq_job_id?: string;
  last_error?: { message?: string } | string | null;
}

interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const App: React.FC = () => {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Tab & Search State
  const [activeTab, setActiveTab] = useState<'scheduled' | 'sent'>('scheduled');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'scheduled' | 'sent' | 'failed'>('all');
  const [page, setPage] = useState(1);

  // Data State
  const [senders, setSenders] = useState<Sender[]>([]);
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>({
    page: 1,
    limit: 15,
    total: 0,
    totalPages: 1,
  });
  const [isLoadingEmails, setIsLoadingEmails] = useState(false);

  // Compose Modal State
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [selectedSenderId, setSelectedSenderId] = useState<string>('');
  const [recipientInputMode, setRecipientInputMode] = useState<'text' | 'csv'>('text');
  const [recipientText, setRecipientText] = useState('');
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [parsedCsvEmails, setParsedCsvEmails] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [scheduledAtLocal, setScheduledAtLocal] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [composeFeedback, setComposeFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Slack Connection State (SLACK-02, SLACK-04, SLACK-06)
  const [slackConn, setSlackConn] = useState<{
    connected: boolean;
    team_name?: string | null;
    channel_name?: string | null;
  } | null>(null);
  const [isDisconnectingSlack, setIsDisconnectingSlack] = useState(false);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Session expiry handler
  const handleSessionExpired = useCallback(() => {
    setUser(null);
    setAuthError('Your session has expired. Please sign in again with Google.');
  }, []);

  // Check initial authentication
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
    } catch {
      setUser(null);
    } finally {
      setIsLoadingAuth(false);
    }
  }, []);

  // Fetch Senders
  const loadSenders = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/senders', { credentials: 'include' });
      if (res.status === 401) {
        handleSessionExpired();
        return;
      }
      if (res.ok) {
        const data = (await res.json()) as { senders: Sender[] };
        setSenders(data.senders || []);
        if (data.senders && data.senders.length > 0 && !selectedSenderId) {
          setSelectedSenderId(data.senders[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch senders:', err);
    }
  }, [user, selectedSenderId, handleSessionExpired]);

  // Fetch Emails (Search or Tab Listing)
  const loadEmails = useCallback(async () => {
    if (!user) return;
    setIsLoadingEmails(true);

    try {
      let endpoint = '';
      if (debouncedSearch) {
        // Full-Text Search via Elasticsearch
        setIsSearching(true);
        const searchStatus = statusFilter !== 'all' ? statusFilter : activeTab;
        endpoint = `/api/emails/search?q=${encodeURIComponent(debouncedSearch)}&page=${page}&limit=15&status=${searchStatus}`;
      } else {
        setIsSearching(false);
        if (activeTab === 'scheduled') {
          endpoint = `/api/emails/scheduled?page=${page}&limit=15`;
        } else {
          const filterParam = statusFilter !== 'all' ? `&status=${statusFilter}` : '';
          endpoint = `/api/emails/sent?page=${page}&limit=15${filterParam}`;
        }
      }

      const res = await fetch(endpoint, { credentials: 'include' });
      if (res.status === 401) {
        handleSessionExpired();
        return;
      }

      if (res.ok) {
        const result = (await res.json()) as { data: EmailItem[]; pagination: PaginationMeta };
        setEmails(result.data || []);
        if (result.pagination) {
          setPagination(result.pagination);
        }
      }
    } catch (err) {
      console.error('Failed to load email records:', err);
    } finally {
      setIsLoadingEmails(false);
    }
  }, [user, debouncedSearch, statusFilter, activeTab, page, handleSessionExpired]);

  // Fetch Slack Connection status (SLACK-04, SLACK-05)
  const loadSlackConnection = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/slack/connection', { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        setSlackConn(json.data || { connected: false });
      }
    } catch (err) {
      console.error('Failed to load Slack connection status:', err);
    }
  }, [user]);

  // Handle Slack Disconnect (SLACK-06)
  const handleDisconnectSlack = async () => {
    if (!confirm('Are you sure you want to disconnect this Slack workspace? Rate-limit notifications will no longer be delivered.')) {
      return;
    }
    setIsDisconnectingSlack(true);
    try {
      const res = await fetch('/api/slack/disconnect', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        setSlackConn({ connected: false });
        setComposeFeedback({
          type: 'success',
          message: 'Slack workspace disconnected successfully.',
        });
      }
    } catch (err) {
      console.error('Failed to disconnect Slack workspace:', err);
    } finally {
      setIsDisconnectingSlack(false);
    }
  };

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const errorParam = urlParams.get('error');
    if (errorParam) {
      setAuthError(decodeURIComponent(errorParam));
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Check Slack OAuth redirect parameters (SLACK-01, SLACK-02)
    if (urlParams.get('slack_connected') === 'true') {
      setComposeFeedback({
        type: 'success',
        message: '🎉 Slack workspace connected! Hourly rate-limit alerts will now be sent to your Slack workspace.',
      });
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (urlParams.get('slack_error')) {
      const slackErr = urlParams.get('slack_error');
      setComposeFeedback({
        type: 'error',
        message: `Slack authorization failed: ${slackErr}`,
      });
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (user) {
      loadSenders();
      loadEmails();
      loadSlackConnection();
    }
  }, [user, loadSenders, loadEmails, loadSlackConnection]);

  // Handle Google Sign In
  const handleGoogleSignIn = () => {
    window.location.href = '/api/auth/google';
  };

  // Handle Logout
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Ignored
    } finally {
      setUser(null);
      setEmails([]);
      setSenders([]);
    }
  };

  // Initialize Compose Modal default date (+10 mins)
  const openComposeModal = () => {
    const defaultDate = new Date(Date.now() + 10 * 60 * 1000);
    // Format YYYY-MM-DDTHH:MM for datetime-local
    const offset = defaultDate.getTimezoneOffset() * 60000;
    const localISOTime = new Date(defaultDate.getTime() - offset).toISOString().slice(0, 16);
    setScheduledAtLocal(localISOTime);
    setComposeFeedback(null);
    setIsComposeOpen(true);
  };

  // Parse CSV File in Browser
  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) return;

      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const matches = content.match(emailRegex) || [];
      const uniqueEmails = Array.from(new Set(matches.map((m) => m.toLowerCase().trim())));

      setParsedCsvEmails(uniqueEmails);
    };
    reader.readAsText(file);
  };

  // Computed Recipient List for Validation
  const effectiveRecipients = useMemo(() => {
    if (recipientInputMode === 'csv') {
      return parsedCsvEmails;
    }
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const matches = recipientText.match(emailRegex) || [];
    return Array.from(new Set(matches.map((m) => m.toLowerCase().trim())));
  }, [recipientInputMode, parsedCsvEmails, recipientText]);

  // Handle Email Scheduling Submission
  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedSenderId) {
      setComposeFeedback({ type: 'error', message: 'Please select a sender account.' });
      return;
    }

    if (effectiveRecipients.length === 0) {
      setComposeFeedback({
        type: 'error',
        message: 'At least one valid recipient email is required.',
      });
      return;
    }

    if (!scheduledAtLocal) {
      setComposeFeedback({ type: 'error', message: 'Scheduled time is required.' });
      return;
    }

    const scheduledDate = new Date(scheduledAtLocal);
    if (scheduledDate.getTime() < Date.now() - 60000) {
      setComposeFeedback({ type: 'error', message: 'Scheduled time cannot be in the past.' });
      return;
    }

    setIsSubmitting(true);
    setComposeFeedback(null);

    const idempotencyKey = `ui_sched_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    try {
      const payload = {
        sender_id: selectedSenderId,
        recipient_emails: effectiveRecipients,
        subject,
        body,
        scheduled_at: scheduledDate.toISOString(),
      };

      const res = await fetch('/api/emails/schedule', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (res.status === 401) {
        handleSessionExpired();
        return;
      }

      const data = await res.json();

      if (res.ok) {
        setComposeFeedback({
          type: 'success',
          message: `Successfully scheduled ${data.scheduledCount || 1} email(s) for ${scheduledDate.toLocaleTimeString()}!`,
        });

        // Reset form
        setRecipientText('');
        setParsedCsvEmails([]);
        setCsvFileName(null);
        setSubject('');
        setBody('');

        // Reload data
        loadEmails();
        setTimeout(() => setIsComposeOpen(false), 1200);
      } else {
        setComposeFeedback({
          type: 'error',
          message: data.error?.message || 'Failed to schedule email.',
        });
      }
    } catch {
      setComposeFeedback({
        type: 'error',
        message: 'Network communication error with scheduling API.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper for quick delay buttons
  const setQuickDelay = (minutes: number) => {
    const target = new Date(Date.now() + minutes * 60 * 1000);
    const offset = target.getTimezoneOffset() * 60000;
    const local = new Date(target.getTime() - offset).toISOString().slice(0, 16);
    setScheduledAtLocal(local);
  };

  // Active sender rate limit details
  const activeSender = senders.find((s) => s.id === selectedSenderId);

  // ============================================================================
  // AUTHENTICATION GUARD: Loading Skeleton
  // ============================================================================
  if (isLoadingAuth) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm font-medium text-slate-400">Verifying session security...</span>
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

            <h1 className="text-2xl font-bold tracking-tight text-white mb-2">ReachInbox Scheduler</h1>
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
  // AUTHENTICATED STATE: Complete Dashboard & Composer
  // ============================================================================
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/70 backdrop-blur-md px-6 py-4 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/30">
              R
            </div>
            <span className="font-semibold text-lg tracking-tight">ReachInbox</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hidden sm:inline-block">
              OAuth Active
            </span>
          </div>

          {/* Action Buttons & User Profile */}
          <div className="flex items-center space-x-2.5">
            {/* Bull Board Monitoring Link (OPS-01) */}
            <a
              href="/admin/queues"
              target="_blank"
              rel="noopener noreferrer"
              className="py-1.5 px-3 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700 text-slate-400 hover:text-indigo-300 text-xs font-medium items-center space-x-1.5 transition hidden lg:flex"
              title="Open Bull Board Queue Monitor"
            >
              <span>📊</span>
              <span>Bull Board</span>
            </a>

            {/* Slack Connection Button/Pill (SLACK-02, SLACK-06) */}
            {slackConn?.connected ? (
              <div className="flex items-center space-x-1.5 bg-slate-800/80 border border-emerald-500/30 rounded-full py-1 px-3 text-xs text-emerald-300">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="hidden sm:inline font-medium">
                  {slackConn.team_name ? `Slack: ${slackConn.team_name}` : 'Slack Connected'}
                </span>
                <button
                  onClick={handleDisconnectSlack}
                  disabled={isDisconnectingSlack}
                  title="Disconnect Slack workspace"
                  className="text-slate-400 hover:text-red-400 ml-1 text-xs transition cursor-pointer"
                >
                  ✕
                </button>
              </div>
            ) : (
              <a
                href="/api/slack/install"
                className="py-1.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 text-slate-300 hover:text-white text-xs font-medium flex items-center space-x-1.5 transition"
                title="Connect Slack workspace to receive rate-limit alerts"
              >
                <span>💬</span>
                <span className="hidden sm:inline">Connect Slack</span>
              </a>
            )}

            <button
              onClick={openComposeModal}
              id="compose-btn"
              className="py-1.5 px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs flex items-center space-x-1.5 shadow-md shadow-indigo-600/30 transition cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
              </svg>
              <span>Compose Email</span>
            </button>

            <div className="flex items-center space-x-2.5 bg-slate-800/60 border border-slate-700/60 rounded-full py-1 px-3">
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
              <div className="text-left hidden md:block">
                <div className="text-xs font-medium text-slate-200">{user.name}</div>
                <div className="text-[10px] text-slate-400 truncate max-w-[130px]">{user.email}</div>
              </div>
            </div>

            <button
              onClick={handleLogout}
              className="text-xs py-1.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Main Dashboard Workspace */}
      <main className="max-w-7xl mx-auto px-6 py-6 flex-1 w-full space-y-6">
        {/* Navigation, Tabs, and Search Bar */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            {/* Tab Controls */}
            <div className="flex items-center space-x-2">
              <button
                onClick={() => {
                  setActiveTab('scheduled');
                  setPage(1);
                }}
                className={`px-4 py-2 rounded-xl text-xs font-semibold tracking-wide transition cursor-pointer ${
                  activeTab === 'scheduled'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25'
                    : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                ⏱️ Scheduled Outbox
              </button>
              <button
                onClick={() => {
                  setActiveTab('sent');
                  setPage(1);
                }}
                className={`px-4 py-2 rounded-xl text-xs font-semibold tracking-wide transition cursor-pointer ${
                  activeTab === 'sent'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25'
                    : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                ✅ Sent & Delivered
              </button>
            </div>

            {/* Elasticsearch Search Bar & Filter */}
            <div className="flex items-center space-x-2 flex-1 max-w-md">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search emails (Elasticsearch full-text)..."
                  className="w-full bg-slate-800/90 border border-slate-700 rounded-xl pl-9 pr-8 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <svg
                  className="w-4 h-4 text-slate-400 absolute left-3 top-2"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1.5 text-slate-400 hover:text-slate-200 text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>

              {activeTab === 'sent' && (
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as 'all' | 'sent' | 'failed');
                    setPage(1);
                  }}
                  className="bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">All Sent</option>
                  <option value="sent">Delivered</option>
                  <option value="failed">Failed</option>
                </select>
              )}

              <button
                onClick={loadEmails}
                title="Refresh Table"
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700 transition cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Active Search & Filter Indicator */}
          {debouncedSearch && (
            <div className="flex items-center space-x-2 text-xs text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 rounded-lg px-3 py-1.5">
              <span>🔍 Searching Elasticsearch for: <strong>"{debouncedSearch}"</strong></span>
              <span>— Found {pagination.total} matching email(s) {isSearching ? '(querying...)' : ''}</span>
            </div>
          )}
        </div>

        {/* Emails Table */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
          {isLoadingEmails ? (
            <div className="py-20 text-center flex flex-col items-center justify-center space-y-3">
              <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-xs text-slate-400">Loading email records...</span>
            </div>
          ) : emails.length === 0 ? (
            <div className="py-20 text-center flex flex-col items-center justify-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-slate-800/80 flex items-center justify-center text-slate-500">
                ✉️
              </div>
              <div className="text-sm font-medium text-slate-300">
                {debouncedSearch
                  ? `No search results matching "${debouncedSearch}"`
                  : activeTab === 'scheduled'
                    ? 'No scheduled emails in queue'
                    : 'No sent emails recorded'}
              </div>
              <p className="text-xs text-slate-500 max-w-sm">
                {activeTab === 'scheduled'
                  ? 'Compose and schedule emails with staggered delays and rate limits.'
                  : 'Delivered and failed emails will appear here after worker processing.'}
              </p>
              {activeTab === 'scheduled' && !debouncedSearch && (
                <button
                  onClick={openComposeModal}
                  className="mt-2 py-1.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer"
                >
                  Compose Your First Email
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="border-b border-slate-800 bg-slate-900/60 text-slate-400 uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="py-3 px-4">Recipient</th>
                    <th className="py-3 px-4">Subject</th>
                    <th className="py-3 px-4">{activeTab === 'scheduled' ? 'Scheduled At' : 'Sent At'}</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Details & Preview</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {emails.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-800/25 transition">
                      <td className="py-3 px-4 font-medium text-slate-200">
                        <div className="truncate max-w-[220px]">{e.recipient_email}</div>
                      </td>
                      <td className="py-3 px-4 text-slate-300">
                        <div className="truncate max-w-[320px] font-medium">{e.subject}</div>
                      </td>
                      <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                        {activeTab === 'scheduled'
                          ? new Date(e.scheduled_at).toLocaleString()
                          : e.sent_at
                            ? new Date(e.sent_at).toLocaleString()
                            : new Date(e.scheduled_at).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium border ${
                            e.status === 'sent'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : e.status === 'failed'
                                ? 'bg-red-500/10 text-red-400 border-red-500/20'
                                : e.status === 'processing'
                                  ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          }`}
                        >
                          {e.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {e.preview_url ? (
                          <a
                            href={e.preview_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center space-x-1 text-xs text-indigo-400 hover:text-indigo-300 hover:underline"
                          >
                            <span>Ethereal Preview</span>
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        ) : e.status === 'failed' ? (
                          <span
                            title={typeof e.last_error === 'string' ? e.last_error : e.last_error?.message || 'Delivery error'}
                            className="text-red-400 text-[11px] cursor-help"
                          >
                            Error info
                          </span>
                        ) : (
                          <span className="text-slate-600 font-mono text-[10px]">
                            {e.bullmq_job_id ? `Job #${e.bullmq_job_id.slice(-6)}` : '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Footer */}
          {pagination.totalPages > 1 && (
            <div className="border-t border-slate-800/80 px-4 py-3 flex items-center justify-between text-xs text-slate-400 bg-slate-900/30">
              <div>
                Page <strong>{pagination.page}</strong> of <strong>{pagination.totalPages}</strong> ({pagination.total} total)
              </div>
              <div className="flex items-center space-x-2">
                <button
                  disabled={pagination.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  Previous
                </button>
                <button
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ======================================================================= */}
      {/* COMPOSE & SCHEDULE MODAL                                                */}
      {/* ======================================================================= */}
      {isComposeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-base font-bold text-white flex items-center space-x-2">
                <span>✉️</span>
                <span>Compose & Schedule Email</span>
              </h2>
              <button
                onClick={() => setIsComposeOpen(false)}
                className="text-slate-400 hover:text-white text-sm p-1 rounded-lg hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            {composeFeedback && (
              <div
                className={`p-3 rounded-xl text-xs ${
                  composeFeedback.type === 'success'
                    ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                    : 'bg-red-500/10 border border-red-500/30 text-red-400'
                }`}
              >
                {composeFeedback.message}
              </div>
            )}

            <form onSubmit={handleScheduleSubmit} className="space-y-4 text-xs">
              {/* Sender Account */}
              <div>
                <label className="block font-medium text-slate-300 mb-1">Sender Account</label>
                <select
                  value={selectedSenderId}
                  onChange={(e) => setSelectedSenderId(e.target.value)}
                  required
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {senders.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.display_name} ({s.email}) — {s.max_emails_per_hour}/hr quota
                    </option>
                  ))}
                </select>
                {activeSender && (
                  <div className="mt-1 text-[11px] text-indigo-400">
                    Inter-send interval: {activeSender.min_send_interval_ms}ms | Hourly limit: {activeSender.max_emails_per_hour} emails
                  </div>
                )}
              </div>

              {/* Recipient Mode Tabs */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-medium text-slate-300">Recipients</label>
                  <div className="flex items-center space-x-1 bg-slate-800 p-0.5 rounded-lg border border-slate-700">
                    <button
                      type="button"
                      onClick={() => setRecipientInputMode('text')}
                      className={`px-2.5 py-0.5 rounded text-[11px] font-medium ${
                        recipientInputMode === 'text'
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Manual / Paste
                    </button>
                    <button
                      type="button"
                      onClick={() => setRecipientInputMode('csv')}
                      className={`px-2.5 py-0.5 rounded text-[11px] font-medium ${
                        recipientInputMode === 'csv'
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      CSV Upload
                    </button>
                  </div>
                </div>

                {recipientInputMode === 'text' ? (
                  <textarea
                    rows={3}
                    value={recipientText}
                    onChange={(e) => setRecipientText(e.target.value)}
                    placeholder="Enter email addresses (separated by commas or newlines)..."
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-[11px]"
                  />
                ) : (
                  <div className="border-2 border-dashed border-slate-700 rounded-xl p-4 text-center bg-slate-800/40">
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={handleCsvFileUpload}
                      className="hidden"
                      id="csv-file-input"
                    />
                    <label
                      htmlFor="csv-file-input"
                      className="cursor-pointer text-indigo-400 hover:text-indigo-300 font-medium"
                    >
                      📁 {csvFileName ? `Selected: ${csvFileName}` : 'Choose CSV File with Recipients'}
                    </label>
                    <p className="text-[10px] text-slate-500 mt-1">
                      Extracts and deduplicates valid email addresses from any column in the CSV.
                    </p>
                  </div>
                )}

                {/* Recipient Count Validation Feedback */}
                <div className="mt-1 flex items-center justify-between text-[11px]">
                  <span
                    className={`font-medium ${
                      effectiveRecipients.length > 0 ? 'text-emerald-400' : 'text-slate-500'
                    }`}
                  >
                    ● Valid Recipients Detected: {effectiveRecipients.length}
                  </span>
                  {effectiveRecipients.length > 1 && (
                    <span className="text-amber-400">
                      Batch send: will be queued with staggered timestamps
                    </span>
                  )}
                </div>
              </div>

              {/* Subject */}
              <div>
                <label className="block font-medium text-slate-300 mb-1">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  required
                  placeholder="Email subject line..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs"
                />
              </div>

              {/* Body */}
              <div>
                <label className="block font-medium text-slate-300 mb-1">Message Body</label>
                <textarea
                  rows={4}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  required
                  placeholder="Enter email message body..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs"
                />
              </div>

              {/* Start / Scheduled Dispatch Time */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-medium text-slate-300">Scheduled Dispatch Time</label>
                  <div className="flex items-center space-x-1">
                    <button
                      type="button"
                      onClick={() => setQuickDelay(5)}
                      className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded text-[10px] text-slate-300 cursor-pointer"
                    >
                      +5m
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuickDelay(30)}
                      className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded text-[10px] text-slate-300 cursor-pointer"
                    >
                      +30m
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuickDelay(120)}
                      className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded text-[10px] text-slate-300 cursor-pointer"
                    >
                      +2h
                    </button>
                  </div>
                </div>
                <input
                  type="datetime-local"
                  value={scheduledAtLocal}
                  onChange={(e) => setScheduledAtLocal(e.target.value)}
                  required
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs"
                />
              </div>

              {/* Submit Buttons */}
              <div className="pt-2 flex items-center space-x-3">
                <button
                  type="button"
                  onClick={() => setIsComposeOpen(false)}
                  className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || effectiveRecipients.length === 0}
                  className="flex-1 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs transition shadow-lg shadow-indigo-600/30 disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? 'Scheduling with BullMQ...' : `Schedule ${effectiveRecipients.length} Email(s)`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-5 text-center text-xs text-slate-500">
        ReachInbox.ai Software Development Intern Assignment &copy; {new Date().getFullYear()}
      </footer>
    </div>
  );
};

export default App;
