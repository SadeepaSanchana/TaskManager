'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabaseClient';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Clock, PlayCircle, RefreshCw, Smartphone, LogOut, MessageSquare } from 'lucide-react';

interface TaskAssignment {
  id: string;
  status: string;
  remark: string | null;
  tasks: {
    title: string;
    description: string;
  };
}

export default function MemberDashboard() {
  const supabase = createClient();
  const router = useRouter();

  const [assignments, setAssignments] = useState<TaskAssignment[]>([]);
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [remarks, setRemarks] = useState<{ [key: string]: string }>({});

  useEffect(() => {
    checkUserAndFetch();
  }, []);

  function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  const registerPushNotifications = async (userId: string) => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      try {
        const register = await navigator.serviceWorker.register('/sw.js');
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;

        const publicVapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!publicVapidKey) return;

        const subscription = await register.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicVapidKey),
        });

        await supabase
          .from('users_profile')
          .update({ push_subscription: subscription })
          .eq('id', userId);
      } catch (err) {
        console.error('PWA Push Registration Error:', err);
      }
    }
  };

  const checkUserAndFetch = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/');
      return;
    }

    const { data: profile } = await supabase
      .from('users_profile')
      .select('name, email')
      .eq('id', user.id)
      .single();

    if (profile) {
      setUserName(profile.name);
      setUserEmail(profile.email || user.email || '');
    }

    registerPushNotifications(user.id);
    fetchTasks(user.id);
  };

  const fetchTasks = async (userId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('task_assignments')
      .select('id, status, remark, tasks(title, description)')
      .eq('user_id', userId);

    if (!error && data) {
      setAssignments(data as unknown as TaskAssignment[]);
      const initialRemarks: { [key: string]: string } = {};
      data.forEach((item: any) => {
        initialRemarks[item.id] = item.remark || '';
      });
      setRemarks(initialRemarks);
    }
    setLoading(false);
  };

  const notifyAdmins = async (taskTitle: string, newStatus: string, remarkText: string) => {
    // Fetch all admin profiles with subscriptions
    const { data: admins } = await supabase
      .from('users_profile')
      .select('push_subscription')
      .eq('role', 'admin');

    if (admins) {
      for (const admin of admins) {
        if (admin.push_subscription) {
          await fetch('/api/push-notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subscription: admin.push_subscription,
              title: `🔄 Task Update: ${userName}`,
              body: `Task: "${taskTitle}" is now ${newStatus}.${remarkText ? ` Remark: ${remarkText}` : ''}`,
              url: '/admin',
            }),
          });
        }
      }
    }
  };

  const updateStatus = async (id: string, newStatus: string, taskTitle: string) => {
    const currentRemark = remarks[id] || '';

    setAssignments((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: newStatus, remark: currentRemark } : item))
    );

    const { error } = await supabase
      .from('task_assignments')
      .update({
        status: newStatus,
        remark: currentRemark,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (!error) {
      await notifyAdmins(taskTitle, newStatus, currentRemark);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-2 sm:p-6 font-sans">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col min-h-[640px]">
        
        {/* Header */}
        <div className="bg-slate-800/80 backdrop-blur-md p-5 border-b border-slate-700/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-600/20 text-blue-400 rounded-xl">
              <Smartphone size={20} />
            </div>
            <div>
              <h1 className="text-base font-bold text-white leading-tight">{userName || 'Member'}</h1>
              <p className="text-[11px] text-slate-400">{userEmail}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={checkUserAndFetch}
              className="p-2 bg-slate-700/50 hover:bg-slate-700 rounded-xl text-slate-300 transition"
              title="Refresh Tasks"
            >
              <RefreshCw size={16} />
            </button>

            <button
              onClick={handleSignOut}
              className="p-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 rounded-xl transition"
              title="Sign Out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>

        {/* Task Cards List */}
        <div className="p-4 space-y-4 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              My Assigned Tasks
            </h2>
            <span className="text-[10px] bg-slate-800 text-slate-300 px-2.5 py-0.5 rounded-full border border-slate-700 font-bold">
              {assignments.length} Tasks
            </span>
          </div>

          {loading ? (
            <div className="p-8 text-center text-slate-500 text-sm bg-slate-900/50 rounded-2xl border border-slate-800">
              Loading tasks...
            </div>
          ) : assignments.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm bg-slate-900/50 rounded-2xl border border-slate-800">
              No tasks assigned to your account yet.
            </div>
          ) : (
            assignments.map((item) => (
              <div
                key={item.id}
                className="bg-slate-800/90 p-5 rounded-2xl border border-slate-700/70 shadow-lg space-y-4 transition hover:border-slate-600"
              >
                <div>
                  <h3 className="text-base font-semibold text-white leading-snug">{item.tasks?.title}</h3>
                  {item.tasks?.description && (
                    <p className="text-xs text-slate-400 mt-2 leading-relaxed bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                      {item.tasks?.description}
                    </p>
                  )}
                </div>

                {/* Remark Input Field */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                    <MessageSquare size={12} className="text-blue-400" /> Add Remark / Note:
                  </label>
                  <input
                    type="text"
                    placeholder="Enter remark (e.g. Completed 50%, Waiting for approval...)"
                    value={remarks[item.id] || ''}
                    onChange={(e) => setRemarks({ ...remarks, [item.id]: e.target.value })}
                    className="w-full bg-slate-900/80 border border-slate-700/80 rounded-xl p-2.5 text-xs text-white outline-none focus:border-blue-500 transition"
                  />
                </div>

                {/* Status Buttons */}
                <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-slate-700/50">
                  <button
                    onClick={() => updateStatus(item.id, 'Pending', item.tasks?.title)}
                    className={`py-2 px-1 text-[11px] font-bold rounded-xl flex items-center justify-center gap-1 border transition ${
                      item.status === 'Pending'
                        ? 'bg-amber-500/20 border-amber-500/80 text-amber-300 shadow-sm'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Clock size={13} /> Pending
                  </button>

                  <button
                    onClick={() => updateStatus(item.id, 'In Progress', item.tasks?.title)}
                    className={`py-2 px-1 text-[11px] font-bold rounded-xl flex items-center justify-center gap-1 border transition ${
                      item.status === 'In Progress'
                        ? 'bg-blue-500/20 border-blue-500/80 text-blue-300 shadow-sm'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <PlayCircle size={13} /> Doing
                  </button>

                  <button
                    onClick={() => updateStatus(item.id, 'Completed', item.tasks?.title)}
                    className={`py-2 px-1 text-[11px] font-bold rounded-xl flex items-center justify-center gap-1 border transition ${
                      item.status === 'Completed'
                        ? 'bg-emerald-500/20 border-emerald-500/80 text-emerald-300 shadow-sm'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <CheckCircle2 size={13} /> Done
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

      </div>
    </div>
  );
}