import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';

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
  // Authentication State
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Login inputs for reference screen fidelity
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Tab & Navigation State
  const [activeTab, setActiveTab] = useState<'scheduled' | 'sent'>('scheduled');
  const [selectedEmail, setSelectedEmail] = useState<EmailItem | null>(null);

  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
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

  // Compose State (Screens 5, 6, 7)
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [selectedSenderId, setSelectedSenderId] = useState<string>('');
  const [recipientInputMode, setRecipientInputMode] = useState<'text' | 'csv'>('text');
  const [recipientText, setRecipientText] = useState('');
  const [manualRecipients, setManualRecipients] = useState<string[]>([]);
  const [parsedCsvEmails, setParsedCsvEmails] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [scheduledAtLocal, setScheduledAtLocal] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSchedulePickerOpen, setIsSchedulePickerOpen] = useState(false);
  const [composeFeedback, setComposeFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Custom delay / quota override state (for UI display matching Screens 5 & 6)
  const [delaySecInput, setDelaySecInput] = useState<string>('2');
  const [hourlyLimitInput, setHourlyLimitInput] = useState<string>('50');

  // Slack Connection State
  const [slackConn, setSlackConn] = useState<{
    connected: boolean;
    team_name?: string | null;
    channel_name?: string | null;
  } | null>(null);
  const [isDisconnectingSlack, setIsDisconnectingSlack] = useState(false);

  // Hidden file input ref for "+ Upload List"
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debounce search input
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
          setDelaySecInput(Math.round(data.senders[0].min_send_interval_ms / 1000).toString());
          setHourlyLimitInput(data.senders[0].max_emails_per_hour.toString());
        }
      }
    } catch (err) {
      console.error('Failed to fetch senders:', err);
    }
  }, [user, selectedSenderId, handleSessionExpired]);

  // Fetch Emails (Elasticsearch search or tab listing)
  const loadEmails = useCallback(async () => {
    if (!user) return;
    setIsLoadingEmails(true);

    try {
      let endpoint = '';
      if (debouncedSearch) {
        endpoint = `/api/emails/search?q=${encodeURIComponent(debouncedSearch)}&page=${page}&limit=20`;
      } else {
        if (activeTab === 'scheduled') {
          endpoint = `/api/emails/scheduled?page=${page}&limit=20`;
        } else {
          endpoint = `/api/emails/sent?page=${page}&limit=20`;
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
      console.error('Failed to load emails:', err);
    } finally {
      setIsLoadingEmails(false);
    }
  }, [user, debouncedSearch, activeTab, page, handleSessionExpired]);

  // Fetch Slack Connection status
  const loadSlackConnection = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/slack/connection', { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        setSlackConn(json.data || { connected: false });
      }
    } catch (err) {
      console.error('Failed to load Slack connection:', err);
    }
  }, [user]);

  // Disconnect Slack
  const handleDisconnectSlack = async () => {
    if (!confirm('Disconnect Slack workspace? Rate-limit notifications will no longer be delivered.')) {
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
          message: 'Slack workspace disconnected.',
        });
      }
    } catch (err) {
      console.error('Failed to disconnect Slack:', err);
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

    if (urlParams.get('slack_connected') === 'true') {
      setComposeFeedback({
        type: 'success',
        message: 'Slack workspace connected! Rate-limit alerts will now be sent to Slack.',
      });
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (urlParams.get('slack_error')) {
      const slackErr = urlParams.get('slack_error');
      setComposeFeedback({
        type: 'error',
        message: `Slack connection error: ${slackErr}`,
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
      setSelectedEmail(null);
    }
  };

  // Open Compose Screen (Screens 5, 6, 7)
  const openComposeModal = () => {
    const defaultDate = new Date(Date.now() + 10 * 60 * 1000);
    const offset = defaultDate.getTimezoneOffset() * 60000;
    const localISOTime = new Date(defaultDate.getTime() - offset).toISOString().slice(0, 16);
    setScheduledAtLocal(localISOTime);
    setComposeFeedback(null);
    setIsSchedulePickerOpen(false);
    setIsComposeOpen(true);
  };

  // CSV File Upload Reader
  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) return;

      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const matches = content.match(emailRegex) || [];
      const uniqueEmails = Array.from(new Set(matches.map((m) => m.toLowerCase().trim())));

      setParsedCsvEmails(uniqueEmails);
      setRecipientInputMode('csv');
    };
    reader.readAsText(file);
  };

  // Trigger file selection
  const triggerUploadList = () => {
    fileInputRef.current?.click();
  };

  // Handle adding text recipients
  const handleAddRecipientKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = recipientText.trim().replace(/,$/, '');
      if (val && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
        if (!manualRecipients.includes(val.toLowerCase())) {
          setManualRecipients((prev) => [...prev, val.toLowerCase()]);
        }
        setRecipientText('');
      }
    }
  };

  const removeRecipient = (emailToRemove: string) => {
    if (recipientInputMode === 'csv') {
      setParsedCsvEmails((prev) => prev.filter((e) => e !== emailToRemove));
    } else {
      setManualRecipients((prev) => prev.filter((e) => e !== emailToRemove));
    }
  };

  // Effective recipient list
  const effectiveRecipients = useMemo(() => {
    if (recipientInputMode === 'csv' && parsedCsvEmails.length > 0) {
      return parsedCsvEmails;
    }
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const fromText = recipientText.match(emailRegex) || [];
    const combined = [...manualRecipients, ...fromText.map((e) => e.toLowerCase().trim())];
    return Array.from(new Set(combined));
  }, [recipientInputMode, parsedCsvEmails, manualRecipients, recipientText]);

  // Schedule Presets (Screen 5)
  const applyPresetTime = (hour: number, minute: number = 0) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(hour, minute, 0, 0);
    const offset = tomorrow.getTimezoneOffset() * 60000;
    const local = new Date(tomorrow.getTime() - offset).toISOString().slice(0, 16);
    setScheduledAtLocal(local);
  };

  // Schedule Submit
  const handleScheduleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!selectedSenderId) {
      setComposeFeedback({ type: 'error', message: 'Please select a sender.' });
      return;
    }

    if (effectiveRecipients.length === 0) {
      setComposeFeedback({
        type: 'error',
        message: 'At least one valid recipient is required.',
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

    const idempotencyKey = `ui_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

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
          message: `Scheduled ${data.scheduledCount || effectiveRecipients.length} email(s) successfully!`,
        });

        // Reset
        setRecipientText('');
        setManualRecipients([]);
        setParsedCsvEmails([]);
        setSubject('');
        setBody('');
        setIsSchedulePickerOpen(false);

        loadEmails();
        setTimeout(() => setIsComposeOpen(false), 1200);
      } else {
        setComposeFeedback({
          type: 'error',
          message: data.error?.message || 'Failed to schedule emails.',
        });
      }
    } catch {
      setComposeFeedback({
        type: 'error',
        message: 'Network error communicating with scheduling API.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Date formatter
  const formatDisplayDate = (isoString?: string | null) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  // Active sender record
  const activeSender = senders.find((s) => s.id === selectedSenderId) || senders[0];

  // ============================================================================
  // 1. AUTHENTICATION LOADING SCREEN
  // ============================================================================
  if (isLoadingAuth) {
    return (
      <div className="min-h-screen bg-[#f9fafb] flex items-center justify-center">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-8 h-8 border-3 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-xs text-gray-500 font-medium">Verifying session...</span>
        </div>
      </div>
    );
  }

  // ============================================================================
  // 2. LOGIN SCREEN (Matches Reference Screen 1)
  // ============================================================================
  if (!user) {
    return (
      <div className="min-h-screen bg-[#f3f4f6] flex items-center justify-center p-4">
        <div className="bg-white border border-gray-100 shadow-sm rounded-2xl w-full max-w-[360px] p-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Login</h1>

          {/* Genuine Google Sign In Button */}
          <button
            onClick={handleGoogleSignIn}
            id="google-signin-btn"
            className="w-full flex items-center justify-center space-x-2.5 py-2.5 px-4 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-medium text-xs transition shadow-2xs cursor-pointer mb-5"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
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
            <span>Login with Google</span>
          </button>

          {/* Divider */}
          <div className="relative flex items-center justify-center mb-5">
            <div className="border-t border-gray-200 w-full" />
            <span className="bg-white px-3 text-[11px] text-gray-400 font-normal absolute whitespace-nowrap">
              Or Sign In with Email/Password
            </span>
          </div>

          {/* Form Inputs (Visual Match for Reference Screen 1) */}
          <div className="space-y-3 mb-5 text-left">
            <div>
              <input
                type="email"
                placeholder="Email Id"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                className="w-full bg-[#f3f4f6] border border-gray-200 rounded-lg px-3.5 py-2.5 text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:bg-white transition"
              />
            </div>
            <div>
              <input
                type="password"
                placeholder="Password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full bg-[#f3f4f6] border border-gray-200 rounded-lg px-3.5 py-2.5 text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:bg-white transition"
              />
            </div>
          </div>

          {/* Green Login Button (Triggers authentic Google Sign-in flow) */}
          <button
            onClick={handleGoogleSignIn}
            className="w-full bg-[#00a86b] hover:bg-[#00925d] text-white font-medium py-2.5 rounded-lg text-sm transition shadow-sm cursor-pointer"
          >
            Login
          </button>

          {authError && (
            <div className="mt-4 p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs text-left">
              {authError}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ============================================================================
  // 3. COMPOSE EMAIL SCREEN / DRAWER (Matches Reference Screens 5, 6, 7)
  // ============================================================================
  if (isComposeOpen) {
    return (
      <div className="min-h-screen bg-white flex flex-col">
        {/* Top Header */}
        <header className="border-b border-gray-200 px-6 py-3.5 flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setIsComposeOpen(false)}
              className="p-1 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition cursor-pointer"
              title="Back"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <h2 className="text-base font-semibold text-gray-900">Compose New Email</h2>
          </div>

          <div className="flex items-center space-x-3">
            {/* Drafts icon */}
            <button className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </button>

            {/* Send Later / Send Action Button (Screen 5 & 6) */}
            <div className="relative">
              <div className="inline-flex rounded-lg shadow-2xs">
                <button
                  type="button"
                  onClick={() => setIsSchedulePickerOpen((prev) => !prev)}
                  className="px-3.5 py-1.5 bg-[#00a86b] hover:bg-[#00925d] text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition cursor-pointer"
                >
                  <span>Send Later</span>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>

              {/* Schedule Later Popover (Screen 5) */}
              {isSchedulePickerOpen && (
                <div className="absolute right-0 mt-2 w-72 bg-white border border-gray-200 rounded-2xl shadow-xl p-4 z-50 text-left space-y-3.5">
                  <div className="font-semibold text-xs text-gray-900">Send Later</div>

                  <div>
                    <label className="text-[11px] text-gray-500 mb-1 block">Pick date & time</label>
                    <input
                      type="datetime-local"
                      value={scheduledAtLocal}
                      onChange={(e) => setScheduledAtLocal(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>

                  {/* Quick Presets */}
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => applyPresetTime(10, 0)}
                      className="w-full text-left px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50 rounded-lg flex items-center justify-between"
                    >
                      <span>Tomorrow - 10:00 AM</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPresetTime(13, 0)}
                      className="w-full text-left px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50 rounded-lg flex items-center justify-between"
                    >
                      <span>Tomorrow - 1:00 PM</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPresetTime(18, 0)}
                      className="w-full text-left px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50 rounded-lg flex items-center justify-between"
                    >
                      <span>Tomorrow - 6:00 PM</span>
                    </button>
                  </div>

                  <div className="flex items-center justify-end space-x-2 pt-2 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={() => setIsSchedulePickerOpen(false)}
                      className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900 font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsSchedulePickerOpen(false);
                        handleScheduleSubmit();
                      }}
                      disabled={isSubmitting}
                      className="px-3.5 py-1.5 bg-[#00a86b] hover:bg-[#00925d] text-white text-xs font-semibold rounded-lg shadow-2xs"
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Feedback Alert */}
        {composeFeedback && (
          <div
            className={`px-6 py-2.5 text-xs font-medium flex items-center justify-between ${
              composeFeedback.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-b border-emerald-100'
                : 'bg-red-50 text-red-800 border-b border-red-100'
            }`}
          >
            <span>{composeFeedback.message}</span>
            <button onClick={() => setComposeFeedback(null)} className="text-gray-400 hover:text-gray-700">✕</button>
          </div>
        )}

        {/* Form Fields Body */}
        <div className="max-w-4xl w-full mx-auto px-6 py-6 flex-1 flex flex-col space-y-4">
          {/* From Field */}
          <div className="flex items-center space-x-3 py-2 border-b border-gray-100">
            <span className="w-16 text-xs text-gray-400 font-medium shrink-0">From:</span>
            <select
              value={selectedSenderId}
              onChange={(e) => {
                setSelectedSenderId(e.target.value);
                const s = senders.find((item) => item.id === e.target.value);
                if (s) {
                  setDelaySecInput(Math.round(s.min_send_interval_ms / 1000).toString());
                  setHourlyLimitInput(s.max_emails_per_hour.toString());
                }
              }}
              className="w-full text-xs text-gray-800 bg-transparent focus:outline-none cursor-pointer"
            >
              {senders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name ? `"${s.display_name}" <${s.email}>` : s.email}
                </option>
              ))}
            </select>
          </div>

          {/* To Field with Recipient Tags (Screen 7) & + Upload List */}
          <div className="flex items-center space-x-3 py-2 border-b border-gray-100 min-h-[42px]">
            <span className="w-16 text-xs text-gray-400 font-medium shrink-0">To:</span>
            <div className="flex-1 flex flex-wrap items-center gap-1.5">
              {/* Recipient Pills (Screen 7) */}
              {effectiveRecipients.slice(0, 4).map((rec) => (
                <span
                  key={rec}
                  className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs px-2.5 py-0.5 rounded-full flex items-center space-x-1.5"
                >
                  <span>{rec}</span>
                  <button
                    type="button"
                    onClick={() => removeRecipient(rec)}
                    className="hover:text-emerald-900 cursor-pointer text-xs"
                  >
                    ✕
                  </button>
                </span>
              ))}

              {effectiveRecipients.length > 4 && (
                <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs px-2 py-0.5 rounded-full font-semibold">
                  +{effectiveRecipients.length - 4}
                </span>
              )}

              {/* Input for typing email */}
              <input
                type="text"
                placeholder={effectiveRecipients.length === 0 ? "recipient@example.com (press Enter or comma)" : "Add more..."}
                value={recipientText}
                onChange={(e) => setRecipientText(e.target.value)}
                onKeyDown={handleAddRecipientKey}
                className="flex-1 min-w-[160px] text-xs text-gray-800 bg-transparent focus:outline-none placeholder-gray-400"
              />
            </div>

            {/* Hidden CSV Input */}
            <input
              type="file"
              ref={fileInputRef}
              accept=".csv,.txt"
              onChange={handleCsvFileUpload}
              className="hidden"
            />

            {/* + Upload List Action Button (Screens 6 & 7) */}
            <button
              type="button"
              onClick={triggerUploadList}
              className="text-[#00a86b] hover:text-[#00925d] text-xs font-semibold flex items-center space-x-1 shrink-0 px-2 py-1 hover:bg-emerald-50 rounded-lg transition cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <span>+ Upload List</span>
            </button>
          </div>

          {/* Subject Field */}
          <div className="flex items-center space-x-3 py-2 border-b border-gray-100">
            <span className="w-16 text-xs text-gray-400 font-medium shrink-0">Subject:</span>
            <input
              type="text"
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full text-xs text-gray-800 bg-transparent focus:outline-none placeholder-gray-400"
            />
          </div>

          {/* Inline Delay & Rate Limit Row (Screens 5 & 6) */}
          <div className="flex items-center space-x-6 py-2 border-b border-gray-100 text-xs text-gray-600">
            <div className="flex items-center space-x-2">
              <span className="text-gray-500">Delay between 2 emails:</span>
              <div className="flex items-center border border-gray-200 rounded-lg px-2 py-0.5 bg-gray-50/50">
                <input
                  type="text"
                  value={delaySecInput}
                  onChange={(e) => setDelaySecInput(e.target.value)}
                  className="w-8 text-center text-xs text-gray-800 bg-transparent focus:outline-none"
                />
                <span className="text-gray-400 text-[11px] ml-1">sec</span>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <span className="text-gray-500">Hourly limit:</span>
              <div className="flex items-center border border-gray-200 rounded-lg px-2 py-0.5 bg-gray-50/50">
                <input
                  type="text"
                  value={hourlyLimitInput}
                  onChange={(e) => setHourlyLimitInput(e.target.value)}
                  className="w-10 text-center text-xs text-gray-800 bg-transparent focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Rich Text Toolbar (Screens 5 & 6) */}
          <div className="flex items-center space-x-1.5 py-2 px-2 bg-gray-50/80 border border-gray-200 rounded-xl text-xs text-gray-600">
            <span className="px-2 py-1 text-gray-700 font-medium">Normal</span>
            <span className="text-gray-300">|</span>
            <button type="button" className="p-1 hover:bg-gray-200 rounded font-bold">B</button>
            <button type="button" className="p-1 hover:bg-gray-200 rounded italic">I</button>
            <button type="button" className="p-1 hover:bg-gray-200 rounded underline">U</button>
            <button type="button" className="p-1 hover:bg-gray-200 rounded line-through">S</button>
            <span className="text-gray-300">|</span>
            <button type="button" className="p-1 hover:bg-gray-200 rounded">🔗</button>
            <button type="button" className="p-1 hover:bg-gray-200 rounded">🖼️</button>
            <span className="text-gray-300">|</span>
            <button type="button" className="p-1 hover:bg-gray-200 rounded">☰</button>
            <button type="button" className="p-1 hover:bg-gray-200 rounded">❝</button>
            <button type="button" className="p-1 hover:bg-gray-200 rounded">&lt;/&gt;</button>
          </div>

          {/* Body Textarea */}
          <div className="flex-1 flex flex-col pt-2">
            <textarea
              rows={12}
              placeholder="Type Your Reply..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full flex-1 p-3 text-xs text-gray-800 placeholder-gray-400 bg-transparent border-none focus:outline-none resize-none leading-relaxed"
            />
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // 4. MAIN HOMEPAGE / DASHBOARD (Matches Reference Screens 2, 3, 4)
  // ============================================================================
  return (
    <div className="h-screen flex overflow-hidden bg-white">
      {/* Sidebar (Matches Left Panel of Screens 2 & 3) */}
      <aside className="w-60 bg-white border-r border-gray-200 flex flex-col justify-between shrink-0 h-full">
        <div className="flex flex-col">
          {/* Logo "ONE" */}
          <div className="px-6 py-5 flex items-center space-x-2">
            <span className="text-2xl font-black tracking-tight text-gray-900">ONE</span>
          </div>

          {/* User Account Switcher Card */}
          <div className="px-4 mb-4">
            <div className="border border-gray-200 rounded-xl p-2.5 flex items-center justify-between hover:bg-gray-50 transition cursor-pointer">
              <div className="flex items-center space-x-2.5 min-w-0">
                {user.avatar_url ? (
                  <img src={user.avatar_url} alt={user.name} className="w-8 h-8 rounded-full shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-emerald-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-gray-900 truncate">{user.name}</div>
                  <div className="text-[10px] text-gray-400 truncate">{user.email}</div>
                </div>
              </div>
              <svg className="w-4 h-4 text-gray-400 shrink-0 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

          {/* Compose Button (Green border button) */}
          <div className="px-4 mb-6">
            <button
              onClick={openComposeModal}
              id="compose-btn"
              className="w-full py-2 px-4 rounded-xl border border-emerald-500 text-emerald-600 hover:bg-emerald-50 font-medium text-xs flex items-center justify-center space-x-2 transition cursor-pointer shadow-2xs"
            >
              <span>Compose</span>
            </button>
          </div>

          {/* Section: Core */}
          <div className="px-6 text-[11px] font-semibold tracking-wider text-gray-400 uppercase mb-2">
            Core
          </div>

          {/* Navigation Menu */}
          <nav className="px-3 space-y-1">
            <button
              onClick={() => {
                setActiveTab('scheduled');
                setSelectedEmail(null);
                setPage(1);
              }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition cursor-pointer ${
                activeTab === 'scheduled' && !selectedEmail
                  ? 'bg-[#e8f8f2] text-[#00a86b] font-semibold'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 font-medium'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Scheduled</span>
              </div>
            </button>

            <button
              onClick={() => {
                setActiveTab('sent');
                setSelectedEmail(null);
                setPage(1);
              }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition cursor-pointer ${
                activeTab === 'sent' && !selectedEmail
                  ? 'bg-[#e8f8f2] text-[#00a86b] font-semibold'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 font-medium'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                <span>Sent</span>
              </div>
            </button>
          </nav>
        </div>

        {/* Sidebar Footer: Integrations & Sign Out */}
        <div className="p-4 border-t border-gray-100 space-y-2">
          {/* Slack Connection Pill */}
          {slackConn?.connected ? (
            <div className="bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg py-1.5 px-2.5 text-[11px] flex items-center justify-between">
              <span className="truncate">🟢 {slackConn.team_name || 'Slack Connected'}</span>
              <button
                onClick={handleDisconnectSlack}
                disabled={isDisconnectingSlack}
                title="Disconnect"
                className="text-gray-400 hover:text-red-500 ml-1 text-xs"
              >
                ✕
              </button>
            </div>
          ) : (
            <a
              href="/api/slack/install"
              className="text-xs text-gray-500 hover:text-emerald-600 flex items-center space-x-1.5 px-2 py-1 rounded hover:bg-gray-50 transition"
            >
              <span>💬</span>
              <span>Connect Slack</span>
            </a>
          )}

          {/* Bull Board Link */}
          <a
            href="/admin/queues"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-500 hover:text-indigo-600 flex items-center space-x-1.5 px-2 py-1 rounded hover:bg-gray-50 transition"
          >
            <span>📊</span>
            <span>Bull Board</span>
          </a>

          {/* Sign Out Action */}
          <button
            onClick={handleLogout}
            className="w-full text-left text-xs text-gray-500 hover:text-red-600 flex items-center space-x-1.5 px-2 py-1 rounded hover:bg-gray-50 transition cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden bg-white">
        {/* Top Header Bar with Centered Search (Screens 2 & 3) */}
        <header className="h-14 border-b border-gray-200 px-6 flex items-center justify-between bg-white shrink-0">
          {/* Centered Search Bar */}
          <div className="relative max-w-md w-full mx-auto">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search"
              className="w-full bg-[#f8fafc] border border-gray-200 rounded-lg pl-9 pr-8 py-1.5 text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:bg-white transition"
            />
            <svg className="w-4 h-4 text-gray-400 absolute left-3 top-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1.5 text-gray-400 hover:text-gray-600 text-xs">
                ✕
              </button>
            )}
          </div>

          {/* Right Action Icons */}
          <div className="flex items-center space-x-3">
            <button
              onClick={loadEmails}
              title="Refresh"
              className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            {user.avatar_url ? (
              <img src={user.avatar_url} alt={user.name} className="w-7 h-7 rounded-full" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-emerald-600 text-white font-bold text-xs flex items-center justify-center">
                {user.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
        </header>

        {/* Content Body: Email Detail (Screen 4) OR Email List (Screens 2 & 3) */}
        <main className="flex-1 overflow-y-auto p-6">
          {selectedEmail ? (
            /* ================================================================ */
            /* EMAIL DETAIL VIEW (Matches Screen 4)                             */
            /* ================================================================ */
            <div className="h-full flex flex-col max-w-4xl mx-auto">
              {/* Back Breadcrumb Navigation */}
              <div className="border-b border-gray-200 pb-4 mb-6 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setSelectedEmail(null)}
                    className="p-1 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-900 transition cursor-pointer"
                    title="Back to list"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                  </button>
                  <span className="text-sm font-semibold text-gray-900">
                    {selectedEmail.recipient_email} / {selectedEmail.subject}
                  </span>
                  <span className="text-xs text-gray-400">[{selectedEmail.id.slice(0, 8)}]</span>
                </div>

                {selectedEmail.preview_url && (
                  <a
                    href={selectedEmail.preview_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center space-x-1"
                  >
                    <span>Open in Ethereal ↗</span>
                  </a>
                )}
              </div>

              {/* Sender Details */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center text-sm shadow-2xs">
                    {(activeSender?.display_name || user?.name || 'A').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-900">
                      {activeSender?.display_name || user?.name}{' '}
                      <span className="text-gray-400 font-normal">&lt;{activeSender?.email || user?.email}&gt;</span>
                    </div>
                    <div className="text-[11px] text-gray-500">to {selectedEmail.recipient_email}</div>
                  </div>
                </div>
                <div className="text-xs text-gray-400">
                  {formatDisplayDate(selectedEmail.sent_at || selectedEmail.scheduled_at)}
                </div>
              </div>

              {/* Message Body Content */}
              <div className="bg-white border border-gray-100 shadow-2xs rounded-2xl p-6 text-sm text-gray-800 space-y-4 leading-relaxed whitespace-pre-wrap">
                {selectedEmail.body}
              </div>
            </div>
          ) : (
            /* ================================================================ */
            /* EMAIL LIST VIEW (Matches Screens 2 & 3)                          */
            /* ================================================================ */
            <div className="max-w-5xl mx-auto">
              {debouncedSearch && (
                <div className="mb-4 text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg p-2.5">
                  Elasticsearch search for: <strong>"{debouncedSearch}"</strong> — Found {pagination.total} result(s)
                </div>
              )}

              {isLoadingEmails ? (
                <div className="py-20 text-center flex flex-col items-center justify-center space-y-2">
                  <div className="w-7 h-7 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-xs text-gray-400">Loading...</span>
                </div>
              ) : emails.length === 0 ? (
                <div className="py-20 text-center flex flex-col items-center justify-center space-y-2">
                  <div className="text-3xl text-gray-300">✉️</div>
                  <div className="text-xs font-medium text-gray-500">
                    {debouncedSearch
                      ? `No search results for "${debouncedSearch}"`
                      : activeTab === 'scheduled'
                      ? 'No scheduled emails in queue'
                      : 'No sent emails recorded yet'}
                  </div>
                </div>
              ) : (
                /* Email Row Cards (Screens 2 & 3) */
                <div className="divide-y divide-gray-100">
                  {emails.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => setSelectedEmail(item)}
                      className="py-3 px-4 hover:bg-gray-50/80 rounded-xl transition cursor-pointer flex items-center justify-between group"
                    >
                      <div className="flex items-center space-x-3.5 min-w-0 flex-1 pr-4">
                        {/* Recipient */}
                        <div className="w-40 shrink-0 truncate text-xs font-semibold text-gray-900">
                          To: {item.recipient_email}
                        </div>

                        {/* Status Badge (Amber for Scheduled/Processing, Green for Sent, Red for Failed) */}
                        {item.status === 'sent' ? (
                          <span className="shrink-0 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold px-2 py-0.5 rounded uppercase tracking-wider">
                            Sent
                          </span>
                        ) : item.status === 'failed' ? (
                          <span className="shrink-0 bg-red-50 text-red-700 border border-red-200 text-[10px] font-semibold px-2 py-0.5 rounded uppercase tracking-wider">
                            Failed
                          </span>
                        ) : (
                          <span className="shrink-0 bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-semibold px-2 py-0.5 rounded uppercase tracking-wider">
                            In Queue
                          </span>
                        )}

                        {/* Subject & Preview Snippet */}
                        <div className="truncate text-xs text-gray-700 min-w-0 flex-1">
                          <span className="font-semibold text-gray-900">{item.subject}</span>
                          <span className="text-gray-400 ml-1.5">— {item.body ? item.body.slice(0, 80) : 'No preview available'}</span>
                        </div>
                      </div>

                      {/* Timestamp on right */}
                      <div className="text-[11px] text-gray-400 shrink-0">
                        {activeTab === 'scheduled'
                          ? formatDisplayDate(item.scheduled_at)
                          : formatDisplayDate(item.sent_at || item.scheduled_at)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
