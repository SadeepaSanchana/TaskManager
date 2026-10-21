'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabaseClient';
import { useRouter } from 'next/navigation';
import { PlusCircle, RefreshCw, UserCheck, UserPlus, LogOut, Shield, MessageSquare, Trash2, Users } from 'lucide-react';

interface LiveStatus {
  id: string;
  task_id: string;
  status: string;
  remark: string | null;
  completed_at: string | null;
  updated_at: string;
  users_profile: { name: string; email: string };
  tasks: { title: string; description: string; created_at: string };
}

interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
}

export default function AdminDashboard() {
  const supabase = createClient();
  const router = useRouter();

  const [statuses, setStatuses] = useState<LiveStatus[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [currentAdmin, setCurrentAdmin] = useState<string>('');
  
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedUser, setSelectedUser] = useState('');
  const [loading, setLoading] = useState(false);

  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('member');
  const [addingMember, setAddingMember] = useState(false);

  useEffect(() => {
    checkAdminAndFetch();

    const channel = supabase
      .channel('realtime_task_status')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'task_assignments' },
        () => {
          fetchData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
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

  const registerAdminPush = async (userId: string) => {
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
        console.error('Admin Push Error:', err);
      }
    }
  };

  const checkAdminAndFetch = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/');
      return;
    }

    const { data: profile } = await supabase
      .from('users_profile')
      .select('name, role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      router.push('/member');
      return;
    }

    setCurrentAdmin(profile.name);
    registerAdminPush(user.id);
    fetchData();
  };

  const fetchData = async () => {
    const { data: assignments } = await supabase
      .from('task_assignments')
      .select('id, task_id, status, remark, completed_at, updated_at, users_profile(name, email), tasks(title, description, created_at)');

    if (assignments) setStatuses(assignments as unknown as LiveStatus[]);

    const { data: userProfiles } = await supabase
      .from('users_profile')
      .select('id, name, email, role');

    if (userProfiles) setUsers(userProfiles);
  };

  const handleSignOut = async () => {
    localStorage.removeItem('remember_me');
    await supabase.auth.signOut();
    router.push('/');
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberName) return alert('Please enter a name');

    setAddingMember(true);
    const newId = crypto.randomUUID();

    const { error } = await supabase
      .from('users_profile')
      .insert([{ id: newId, name: newMemberName, email: newMemberEmail, role: newMemberRole }]);

    if (error) {
      alert('Error adding profile: ' + error.message);
    } else {
      setNewMemberName('');
      setNewMemberEmail('');
      alert('Profile added successfully!');
      fetchData();
    }
    setAddingMember(false);
  };

  const handleDeleteMember = async (userId: string, userName: string) => {
    if (!confirm(`Are you sure you want to delete member "${userName}"?`)) return;

    const { error } = await supabase
      .from('users_profile')
      .delete()
      .eq('id', userId);

    if (error) {
      alert('Error deleting member: ' + error.message);
    } else {
      alert('Member deleted successfully!');
      fetchData();
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !selectedUser) return alert('Please fill in required fields');

    setLoading(true);

    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .insert([{ title, description }])
      .select()
      .single();

    if (taskError) {
      alert('Error creating task');
      setLoading(false);
      return;
    }

    const { error: assignError } = await supabase
      .from('task_assignments')
      .insert([{ task_id: task.id, user_id: selectedUser, status: 'Pending' }]);

    if (assignError) {
      alert('Error assigning task');
    } else {
      const { data: memberProfile } = await supabase
        .from('users_profile')
        .select('push_subscription')
        .eq('id', selectedUser)
        .single();

      if (memberProfile?.push_subscription) {
        await fetch('/api/push-notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription: memberProfile.push_subscription,
            title: '📌 New Task Assigned!',
            body: `Task: ${title}`,
            url: '/member',
          }),
        });
      }

      setTitle('');
      setDescription('');
      setSelectedUser('');
      fetchData();
      alert('Task assigned successfully!');
    }
    setLoading(false);
  };

  const handleDeleteTask = async (taskId: string, taskTitle: string, status: string) => {
    if (status !== 'Completed') {
      return alert('Only completed tasks can be deleted!');
    }

    if (!confirm(`Delete completed task "${taskTitle}"?`)) return;

    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', taskId);

    if (error) {
      alert('Error deleting task: ' + error.message);
    } else {
      alert('Completed task deleted successfully!');
      fetchData();
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex items-center justify-between bg-slate-900/90 p-5 rounded-3xl border border-slate-800 shadow-xl backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-purple-600/20 text-purple-400 rounded-2xl border border-purple-500/30">
              <Shield size={22} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Admin Dashboard</h1>
              <p className="text-xs text-slate-400">Welcome, {currentAdmin || 'Administrator'}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={fetchData}
              className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-2xl transition"
              title="Refresh Data"
            >
              <RefreshCw size={18} />
            </button>

            <button 
              onClick={handleSignOut}
              className="p-2.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 rounded-2xl transition flex items-center gap-1.5 text-xs font-semibold"
            >
              <LogOut size={16} /> Logout
            </button>
          </div>
        </div>

        {/* Form 1: Add User Profile */}
        <form onSubmit={handleAddMember} className="bg-slate-900/80 p-6 rounded-3xl border border-slate-800 shadow-xl space-y-4">
          <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2 border-b pb-3 border-slate-800">
            <UserPlus size={18} className="text-emerald-400" /> Add Member / Admin Profile
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Full Name</label>
              <input
                type="text"
                placeholder="Enter full name"
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                className="p-3 bg-slate-800/80 border border-slate-700/80 rounded-xl w-full text-sm text-white outline-none focus:border-blue-500 transition"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Email Address</label>
              <input
                type="email"
                placeholder="Enter email address"
                value={newMemberEmail}
                onChange={(e) => setNewMemberEmail(e.target.value)}
                className="p-3 bg-slate-800/80 border border-slate-700/80 rounded-xl w-full text-sm text-white outline-none focus:border-blue-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Role</label>
              <select
                value={newMemberRole}
                onChange={(e) => setNewMemberRole(e.target.value)}
                className="p-3 bg-slate-800/80 border border-slate-700/80 rounded-xl w-full text-sm text-white outline-none focus:border-blue-500 transition"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={addingMember}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition shadow-lg shadow-emerald-600/20"
          >
            {addingMember ? 'Saving...' : 'Add Profile'}
          </button>
        </form>

        {/* Member Management List */}
        <div className="bg-slate-900/80 p-6 rounded-3xl border border-slate-800 shadow-xl space-y-4">
          <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2 border-b pb-3 border-slate-800">
            <Users size={18} className="text-blue-400" /> Manage Members & Admins
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {users.map((user) => (
              <div key={user.id} className="bg-slate-800/80 p-3.5 rounded-2xl border border-slate-700/60 flex items-center justify-between">
                <div>
                  <div className="font-bold text-sm text-white">{user.name}</div>
                  <div className="text-[11px] text-slate-400">{user.email || 'No email'} <span className="text-blue-400 font-semibold">[{user.role}]</span></div>
                </div>

                <button
                  onClick={() => handleDeleteMember(user.id, user.name)}
                  className="p-2 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded-xl transition border border-red-500/30"
                  title="Delete Member"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Form 2: Create & Assign Task */}
        <form onSubmit={handleCreateTask} className="bg-slate-900/80 p-6 rounded-3xl border border-slate-800 shadow-xl space-y-4">
          <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2 border-b pb-3 border-slate-800">
            <PlusCircle size={18} className="text-blue-400" /> Create & Assign Task
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Task Title</label>
              <input
                type="text"
                placeholder="Enter task title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="p-3 bg-slate-800/80 border border-slate-700/80 rounded-xl w-full text-sm text-white outline-none focus:border-blue-500 transition"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Assign Member</label>
              <select
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value)}
                className="p-3 bg-slate-800/80 border border-slate-700/80 rounded-xl w-full text-sm text-white outline-none focus:border-blue-500 transition"
                required
              >
                <option value="" className="text-slate-500">-- Select Member --</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id} className="bg-slate-900 text-white">
                    {u.name} {u.email ? `(${u.email})` : ''} [{u.role}]
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Task Description</label>
            <textarea
              placeholder="Enter task details or instructions..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="p-3 bg-slate-800/80 border border-slate-700/80 rounded-xl w-full text-sm text-white outline-none focus:border-blue-500 transition"
              rows={3}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition shadow-lg shadow-blue-600/20"
          >
            {loading ? 'Assigning...' : 'Assign Task'}
          </button>
        </form>

        {/* Realtime Progress Monitor Table */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between">
            <h2 className="font-bold text-slate-300 text-xs uppercase tracking-wider flex items-center gap-2">
              <UserCheck size={16} className="text-emerald-400" /> Live Member Progress
            </h2>
            <span className="text-[10px] bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 px-2.5 py-0.5 rounded-full font-bold">
              Realtime Active
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-950/60 border-b border-slate-800 text-[10px] uppercase text-slate-400 font-bold tracking-wider">
                  <th className="p-4">Member</th>
                  <th className="p-4">Task</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Remark</th>
                  <th className="p-4">Dates (Added / Completed)</th>
                  <th className="p-4">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-xs">
                {statuses.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-500">No task assignments found</td>
                  </tr>
                ) : (
                  statuses.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-800/40 transition">
                      <td className="p-4">
                        <div className="font-bold text-white">{row.users_profile?.name || 'User'}</div>
                        <div className="text-[10px] text-slate-400">{row.users_profile?.email}</div>
                      </td>
                      <td className="p-4">
                        <div className="font-semibold text-slate-200">{row.tasks?.title}</div>
                        <div className="text-[11px] text-slate-400">{row.tasks?.description}</div>
                      </td>
                      <td className="p-4">
                        <span
                          className={`px-3 py-1 text-[11px] rounded-full font-bold inline-block border ${
                            row.status === 'Completed'
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                              : row.status === 'In Progress'
                              ? 'bg-blue-500/20 text-blue-300 border-blue-500/50'
                              : 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                          }`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="p-4">
                        {row.remark ? (
                          <div className="text-slate-300 text-xs bg-slate-800/80 p-2 rounded-xl border border-slate-700/60 flex items-center gap-1.5 max-w-xs">
                            <MessageSquare size={13} className="text-blue-400 shrink-0" />
                            <span>{row.remark}</span>
                          </div>
                        ) : (
                          <span className="text-slate-600 text-xs italic">No remark</span>
                        )}
                      </td>
                      <td className="p-4 text-[11px] text-slate-300 space-y-1">
                        <div><span className="text-slate-500">Added:</span> {row.tasks?.created_at ? new Date(row.tasks.created_at).toLocaleString() : 'N/A'}</div>
                        <div>
                          <span className="text-slate-500">Completed:</span>{' '}
                          {row.completed_at ? (
                            <span className="text-emerald-400 font-medium">{new Date(row.completed_at).toLocaleString()}</span>
                          ) : (
                            <span className="text-slate-500 italic">Not yet</span>
                          )}
                        </div>
                      </td>
                      <td className="p-4">
                        <button
                          onClick={() => handleDeleteTask(row.task_id, row.tasks?.title, row.status)}
                          disabled={row.status !== 'Completed'}
                          className={`p-2 rounded-xl transition border flex items-center gap-1 text-[11px] font-bold ${
                            row.status === 'Completed'
                              ? 'bg-red-600/20 hover:bg-red-600/40 text-red-400 border-red-500/30 cursor-pointer'
                              : 'bg-slate-800/40 text-slate-600 border-slate-800 cursor-not-allowed opacity-50'
                          }`}
                          title={row.status === 'Completed' ? 'Delete Task' : 'Only completed tasks can be deleted'}
                        >
                          <Trash2 size={14} /> Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}