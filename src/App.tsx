/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  auth, 
  db, 
  googleProvider 
} from './firebase';
import { 
  signInWithPopup, 
  onAuthStateChanged, 
  signOut,
  GoogleAuthProvider,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  limit,
  addDoc,
  serverTimestamp,
  updateDoc
} from 'firebase/firestore';
import { 
  Youtube, 
  Bell, 
  MessageSquare, 
  LogOut, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle,
  Play,
  User as UserIcon,
  Settings,
  History,
  ExternalLink,
  Loader2,
  Search,
  SortAsc,
  SortDesc,
  LayoutDashboard,
  Compass,
  X,
  Share2,
  Bookmark,
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import { Toaster, toast } from 'sonner';
import { cn } from './lib/utils';

// Initialize Gemini
const geminiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
const ai = new GoogleGenAI({ apiKey: geminiKey });
console.log("Is Gemini Key Loaded?", !!geminiKey);
interface YouTubeSubscription {
  id: string;
  snippet: {
    title: string;
    resourceId: { channelId: string };
    thumbnails: { default: { url: string } };
  };
}

interface NotificationRecord {
  id: string;
  videoId: string;
  videoTitle: string;
  channelName: string;
  summary: string;
  sentAt: any;
  videoUrl: string;
  publishedAt: string;
}

// Firestore Error Handling
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: any[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscriptions, setSubscriptions] = useState<YouTubeSubscription[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [checking, setChecking] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'summaries' | 'subscriptions' | 'explore' | 'alerts' | 'settings'>('dashboard');
  const [videoUrl, setVideoUrl] = useState('');
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [selectedSummary, setSelectedSummary] = useState<NotificationRecord | null>(null);
  const [recentVideos, setRecentVideos] = useState<any[]>([]);
  const [isFetchingRecent, setIsFetchingRecent] = useState(false);
  const [exploreVideos, setExploreVideos] = useState<any[]>([]);
  const [isFetchingExplore, setIsFetchingExplore] = useState(false);
  const [userSettings, setUserSettings] = useState<{
    emailNotifications: boolean;
    summaryLength: 'short' | 'medium' | 'long';
  }>({
    emailNotifications: true,
    summaryLength: 'medium'
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (user) {
        // Fetch user settings
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setIsMonitoring(data.isMonitoring || false);
          if (data.settings) {
            setUserSettings(data.settings);
          }
        } else {
          // Initialize user doc
          const initialSettings = {
            emailNotifications: true,
            summaryLength: 'medium' as const
          };
          await setDoc(doc(db, 'users', user.uid), {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            isMonitoring: false,
            settings: initialSettings
          });
          setUserSettings(initialSettings);
        }

        // Listen for notifications
        const q = query(
          collection(db, 'users', user.uid, 'notifications'),
          orderBy('sentAt', 'desc'),
          limit(10)
        );
        onSnapshot(q, (snapshot) => {
          setNotifications(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as NotificationRecord)));
        });
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (accessToken) {
      fetchSubscriptions(true);
    }
  }, [accessToken]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isMonitoring && accessToken) {
      // Initial check
      checkNewVideos();
      // Periodic check every 5 minutes
      interval = setInterval(checkNewVideos, 5 * 60 * 1000);
    }
    return () => clearInterval(interval);
  }, [isMonitoring, accessToken]);

  useEffect(() => {
    if (activeTab === 'explore' && exploreVideos.length === 0) {
      fetchExploreVideos();
    }
  }, [activeTab]);

  const handleLogin = async () => {
    setIsSigningIn(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential) {
        setAccessToken(credential.accessToken || null);
        toast.success('Successfully signed in!');
      }
    } catch (error: any) {
      console.error('Login error:', error);
      if (error.code === 'auth/popup-closed-by-user') {
        toast.error('The sign-in window was closed. Please ensure popups are enabled and try again.');
      } else if (error.code === 'auth/cancelled-by-user') {
        toast.error('Sign-in was cancelled.');
      } else if (error.code === 'auth/popup-blocked') {
        toast.error('Popup blocked! Please enable popups for this site in your browser settings.');
      } else {
        toast.error('An error occurred during sign-in. Please check your connection.');
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleLogout = () => signOut(auth);

  const fetchSubscriptions = useCallback(async (isInitial = false) => {
    if (!accessToken) {
      toast.error('YouTube access token missing. Please sign in again.');
      return;
    }
    
    setChecking(true);
    const tokenToUse = isInitial ? null : nextPageToken;

    try {
      const url = new URL('https://www.googleapis.com/youtube/v3/subscriptions');
      url.searchParams.append('part', 'snippet');
      url.searchParams.append('mine', 'true');
      url.searchParams.append('maxResults', '50');
      if (tokenToUse) {
        url.searchParams.append('pageToken', tokenToUse);
      }

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      const data = await response.json() as { items?: YouTubeSubscription[], nextPageToken?: string, error?: any };
      if (data.error) {
        if (data.error.code === 401) {
          toast.error('Session expired. Please sign in again.');
        } else {
          toast.error('YouTube API Error: ' + data.error.message);
        }
        return;
      }

      const newItems = data.items || [];
      const nextToken = data.nextPageToken || null;
      
      setSubscriptions(prev => {
        if (isInitial) return newItems;
        // Avoid duplicates
        const existingIds = new Set(prev.map(s => s.id));
        const filteredNew = newItems.filter(item => !existingIds.has(item.id));
        return [...prev, ...filteredNew];
      });
      
      setNextPageToken(nextToken);
      
      if (newItems.length > 0) {
        if (isInitial) {
          toast.success(`Synced ${newItems.length} channels!`);
          fetchRecentVideos(newItems.slice(0, 12));
        } else {
          toast.success(`Loaded ${newItems.length} more channels!`);
        }
      }
    } catch (error) {
      console.error('Fetch subscriptions error:', error);
      toast.error('Network error while fetching subscriptions.');
    } finally {
      setChecking(false);
    }
  }, [accessToken, nextPageToken]);

  const summarizeVideo = async (videoTitle: string, channelName: string, videoId?: string) => {
    const lengthInstructions = {
      short: "Keep it very brief, under 100 words. Focus only on the most critical takeaway.",
      medium: "Provide a balanced summary with key takeaways and main points. Around 250 words.",
      long: "Provide a detailed, comprehensive summary covering all aspects of the video. 500+ words."
    };

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: `Generate a deep, structured summary for a YouTube video titled "${videoTitle}" from the channel "${channelName}". 
        ${lengthInstructions[userSettings.summaryLength]}
        The summary should include:
        1. Key Takeaways
        2. Main Discussion Points
        3. Conclusion
        Keep it professional. Use Markdown.`,
      });
      return response.text;
    } catch (error) {
      console.error('Summarization error:', error);
      return 'Failed to generate summary.';
    }
  };

  const handleSummarizeUrl = async () => {
    if (!videoUrl || !user || !accessToken) return;
    
    const videoIdMatch = videoUrl.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (!videoIdMatch) {
      toast.error('Invalid YouTube URL');
      return;
    }
    
    const videoId = videoIdMatch[1];
    setIsSummarizing(true);
    
    try {
      // Fetch video details from YouTube API
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` }
        }
      );
      const data = await response.json();
      const video = data.items?.[0];
      
      if (!video) {
        toast.error('Video not found');
        return;
      }
      
      const videoTitle = video.snippet.title;
      const channelName = video.snippet.channelTitle;
      const publishedAt = video.snippet.publishedAt;
      const videoLink = `https://www.youtube.com/watch?v=${videoId}`;
      
      const summary = await summarizeVideo(videoTitle, channelName, videoId);
      
      const notifRef = doc(db, 'users', user.uid, 'notifications', videoId);
      const newNotif = {
        videoId,
        videoTitle,
        channelName,
        summary,
        videoUrl: videoLink,
        publishedAt,
        sentAt: serverTimestamp()
      };
      
      await setDoc(notifRef, newNotif);
      setSelectedSummary({ id: videoId, ...newNotif } as NotificationRecord);
      setVideoUrl('');
      toast.success('Summary generated!');
    } catch (error) {
      console.error('URL summarization error:', error);
      toast.error('Failed to summarize video');
    } finally {
      setIsSummarizing(false);
    }
  };

  const fetchRecentVideos = async (channels: YouTubeSubscription[]) => {
    if (!accessToken) return;
    setIsFetchingRecent(true);
    const videos: any[] = [];
    
    try {
      // Fetch latest video for each channel (limit to first 8 for performance/quota)
      const fetchPromises = channels.slice(0, 8).map(async (sub) => {
        const channelId = sub.snippet.resourceId.channelId;
        const response = await fetch(
          `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&order=date&type=video&maxResults=1`,
          {
            headers: { Authorization: `Bearer ${accessToken}` }
          }
        );
        const data = await response.json();
        return data.items?.[0];
      });

      const results = await Promise.all(fetchPromises);
      results.forEach(video => {
        if (video) videos.push(video);
      });
      
      setRecentVideos(videos);
    } catch (error) {
      console.error('Error fetching recent videos:', error);
    } finally {
      setIsFetchingRecent(false);
    }
  };

  const fetchExploreVideos = async () => {
    if (!accessToken) return;
    setIsFetchingExplore(true);
    try {
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&chart=mostPopular&maxResults=12&regionCode=US`,
        {
          headers: { Authorization: `Bearer ${accessToken}` }
        }
      );
      const data = await response.json();
      setExploreVideos(data.items || []);
    } catch (error) {
      console.error('Error fetching explore videos:', error);
      toast.error('Failed to fetch trending videos');
    } finally {
      setIsFetchingExplore(false);
    }
  };

  const formatYouTubeDuration = (duration: string) => {
    const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
    if (!match) return '';
    
    const hours = (match[1] || '').replace('H', '');
    const minutes = (match[2] || '').replace('M', '');
    const seconds = (match[3] || '').replace('S', '');

    let result = '';
    if (hours) result += `${hours}:`;
    result += `${minutes.padStart(hours ? 2 : 1, '0')}:`;
    result += seconds.padStart(2, '0');
    return result;
  };

  const handleVideoClick = async (video: any) => {
    const videoId = typeof video.id === 'string' ? video.id : video.id.videoId;
    const videoTitle = video.snippet.title;
    const channelName = video.snippet.channelTitle;
    const publishedAt = video.snippet.publishedAt;
    const videoLink = `https://www.youtube.com/watch?v=${videoId}`;

    // Check if summary already exists in notifications state
    const existing = notifications.find(n => n.videoId === videoId);
    if (existing) {
      setSelectedSummary(existing);
      return;
    }

    // Check Firestore
    if (!user) return;
    const path = `users/${user.uid}/notifications/${videoId}`;
    const notifRef = doc(db, 'users', user.uid, 'notifications', videoId);
    
    let notifDoc;
    try {
      notifDoc = await getDoc(notifRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
      return;
    }
    
    if (notifDoc.exists()) {
      setSelectedSummary({ id: videoId, ...notifDoc.data() } as NotificationRecord);
      return;
    }

    // Generate new summary
    setIsSummarizing(true);
    toast.info(`Summarizing: ${videoTitle}...`);
    
    try {
      const summary = await summarizeVideo(videoTitle, channelName, videoId);
      const newNotif = {
        videoId,
        videoTitle,
        channelName,
        summary,
        videoUrl: videoLink,
        publishedAt,
        sentAt: serverTimestamp()
      };
      
      try {
        await setDoc(notifRef, newNotif);
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
      }
      
      setSelectedSummary({ id: videoId, ...newNotif } as NotificationRecord);
      toast.success('Summary ready!');
    } catch (error) {
      console.error('Error summarizing on click:', error);
      if (error instanceof Error && error.message.includes('operationType')) {
        toast.error('Permission denied. Please check security rules.');
      } else {
        toast.error('Failed to generate summary');
      }
    } finally {
      setIsSummarizing(false);
    }
  };

  const checkNewVideos = async () => {
    if (!accessToken || !user) return;
    setChecking(true);
    try {
      // Check the top 10 channels for new videos
      const channelsToCheck = subscriptions.slice(0, 10);
      let foundNew = false;
      
      for (const sub of channelsToCheck) {
        const channelId = sub.snippet.resourceId.channelId;
        const response = await fetch(
          `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&order=date&type=video&maxResults=1`,
          {
            headers: { Authorization: `Bearer ${accessToken}` }
          }
        );
        const data = await response.json();
        const latestVideo = data.items?.[0];

        if (latestVideo) {
          const videoId = latestVideo.id.videoId;
          const videoTitle = latestVideo.snippet.title;
          const channelName = latestVideo.snippet.channelTitle;
          const publishedAt = latestVideo.snippet.publishedAt;
          const videoLink = `https://www.youtube.com/watch?v=${videoId}`;

          // Check if we already notified for this video
          const notifRef = doc(db, 'users', user.uid, 'notifications', videoId);
          const notifDoc = await getDoc(notifRef);

          if (!notifDoc.exists()) {
            foundNew = true;
            const summary = await summarizeVideo(videoTitle, channelName, videoId);

            // Save notification
            const newNotif = {
              videoId,
              videoTitle,
              channelName,
              summary,
              videoUrl: videoLink,
              publishedAt,
              sentAt: serverTimestamp()
            };
            
            await setDoc(notifRef, newNotif);

            // Trigger backend notification (Email) if enabled
            if (userSettings.emailNotifications) {
              await fetch('/api/notify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  email: user.email,
                  videoTitle,
                  channelName,
                  summary,
                  videoLink,
                  publishedAt
                })
              });
              toast.success(`New video from ${channelName}! Summary sent to email.`);
            } else {
              toast.success(`New video from ${channelName}! Summary saved to alerts.`);
            }
          }
        }
      }

      if (foundNew) {
        // Refresh recent videos list to show the new ones
        fetchRecentVideos(subscriptions.slice(0, 12));
      }
    } catch (error) {
      console.error('Check videos error:', error);
    } finally {
      setChecking(false);
    }
  };

  const toggleMonitoring = async () => {
    if (!user) return;
    const newState = !isMonitoring;
    setIsMonitoring(newState);
    await updateDoc(doc(db, 'users', user.uid), { isMonitoring: newState });
  };

  const updateSettings = async (newSettings: typeof userSettings) => {
    if (!user) return;
    setUserSettings(newSettings);
    await updateDoc(doc(db, 'users', user.uid), { settings: newSettings });
    toast.success('Settings updated!');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-red-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center p-6 text-white font-sans">
        <Toaster position="top-center" richColors />
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-[#141414] border border-[#222] rounded-[32px] p-10 space-y-8 text-center shadow-2xl"
        >
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-[#e62117] rounded-[24px] flex items-center justify-center shadow-2xl shadow-red-600/20">
              <Youtube className="w-12 h-12 text-white fill-current" />
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">TubeSummarist AI</h1>
            <p className="text-slate-500 text-sm">Welcome back to intelligent watching</p>
          </div>
          
          <div className="space-y-6">
            <div className="text-left space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">YouTube Account Email</label>
              <input 
                type="email" 
                placeholder="alex@gmail.com" 
                className="w-full bg-[#0a0a0a] border border-[#222] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-red-600 transition-colors"
                readOnly
                value=''
              />
              <p className="text-[10px] text-slate-600 flex items-center gap-1 ml-1">
                <AlertCircle className="w-3 h-3" />
                Please use the same email linked to your YouTube account for syncing.
              </p>
            </div>

            <button
              onClick={handleLogin}
              disabled={isSigningIn}
              className="w-full bg-[#e62117] text-white font-bold py-4 px-6 rounded-xl flex items-center justify-center gap-3 hover:bg-red-600 transition-all active:scale-95 disabled:opacity-50 shadow-lg shadow-red-600/20"
            >
              {isSigningIn ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <img src="https://www.google.com/favicon.ico" className="w-5 h-5 invert" alt="Google" />
              )}
              {isSigningIn ? 'Connecting...' : 'Login to Dashboard'}
            </button>
          </div>

          <div className="pt-6 border-t border-[#222]">
            <p className="text-xs text-slate-500">
              Don't have an account? <span className="text-red-500 font-bold cursor-pointer hover:underline">Sign Up</span>
            </p>
          </div>

          <div className="bg-red-900/10 border border-red-900/20 p-4 rounded-xl text-left space-y-2">
            <h4 className="text-xs font-bold text-red-500 flex items-center gap-2 uppercase tracking-wider">
              <AlertCircle className="w-3 h-3" />
              Connection Error?
            </h4>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              If you see "unauthorized-domain", please ensure this URL is added to your Firebase Auth Settings.
              <br />• <a href={window.location.href} target="_blank" rel="noreferrer" className="text-red-500 underline">Open in new tab</a>
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans flex">
      <Toaster position="top-center" richColors />
      
      {/* Sidebar */}
      <aside className="w-64 border-r border-[#1a1a1a] flex flex-col fixed inset-y-0 bg-[#0a0a0a] z-50">
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 bg-[#e62117] rounded-lg flex items-center justify-center">
            <Youtube className="w-5 h-5 text-white fill-current" />
          </div>
          <span className="font-bold text-xl tracking-tight">TubeSum AI</span>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-2">
          {[
            { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
            { id: 'summaries', icon: History, label: 'Summaries' },
            { id: 'subscriptions', icon: UserIcon, label: 'Subscriptions' },
            { id: 'explore', icon: Compass, label: 'Explore' },
            { id: 'alerts', icon: Bell, label: 'Alerts' },
            { id: 'settings', icon: Settings, label: 'Settings' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all",
                activeTab === item.id 
                  ? "bg-[#1a1a1a] text-white" 
                  : "text-slate-500 hover:text-white hover:bg-[#111]"
              )}
            >
              <item.icon className={cn("w-5 h-5", activeTab === item.id ? "text-red-500" : "text-slate-500")} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-[#1a1a1a]">
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-slate-500 hover:text-white hover:bg-[#111] transition-all"
          >
            <LogOut className="w-5 h-5" />
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 ml-64 min-h-screen">
        {/* Top Bar */}
        <header className="h-20 border-b border-[#1a1a1a] px-8 flex items-center justify-between sticky top-0 bg-[#0a0a0a]/80 backdrop-blur-md z-40">
          <div className="relative w-full max-w-xl">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input 
              type="text"
              placeholder="Search summaries or paste YouTube URL..."
              className="w-full bg-[#111] border border-[#222] rounded-full pl-11 pr-4 py-2.5 text-sm focus:outline-none focus:border-red-600 transition-colors"
            />
          </div>

          <div className="flex items-center gap-6">
            {!accessToken && (
              <button 
                onClick={handleLogin}
                className="flex items-center gap-2 bg-red-600/10 text-red-500 border border-red-600/20 px-4 py-2 rounded-xl text-xs font-bold hover:bg-red-600/20 transition-all"
              >
                <AlertCircle className="w-4 h-4" />
                Reconnect YouTube
              </button>
            )}
            <div 
              className="relative cursor-pointer group"
              onClick={() => setActiveTab('alerts')}
            >
              <Bell className={cn(
                "w-5 h-5 transition-colors",
                activeTab === 'alerts' ? "text-red-500" : "text-slate-400 group-hover:text-white"
              )} />
              {notifications.length > 0 && (
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 rounded-full text-[10px] flex items-center justify-center border-2 border-[#0a0a0a] animate-pulse">
                  {notifications.length > 9 ? '9+' : notifications.length}
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-3 pl-6 border-l border-[#1a1a1a]">
              <div className="text-right">
                <p className="text-sm font-bold leading-none">{user.displayName}</p>
                <p className="text-[10px] text-slate-500 mt-1">{user.email}</p>
              </div>
              <div className="w-10 h-10 rounded-full overflow-hidden border border-[#222] bg-red-600 flex items-center justify-center text-xs font-bold">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="Profile" referrerPolicy="no-referrer" />
                ) : (
                  user.displayName?.charAt(0)
                )}
              </div>
            </div>
          </div>
        </header>

        <div className="p-8">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-12"
              >
                {/* Hero Section */}
                <section className="relative overflow-hidden bg-gradient-to-br from-[#2a0a0a] to-[#0a0a0a] rounded-[40px] border border-red-900/20 p-12 space-y-8">
                  <div className="space-y-4 max-w-2xl">
                    <h1 className="text-6xl font-bold tracking-tight leading-tight">Focus on what matters.</h1>
                    <p className="text-lg text-slate-400 leading-relaxed">
                      Avoid the rabbit hole. Get AI-powered summaries of your favorite creator's content instantly.
                    </p>
                  </div>

                  <div className="flex gap-4 max-w-2xl">
                    <div className="relative flex-1">
                      <input 
                        type="text"
                        placeholder="Paste YouTube link here..."
                        value={videoUrl}
                        onChange={(e) => setVideoUrl(e.target.value)}
                        className="w-full bg-[#1a1a1a]/50 backdrop-blur-md border border-[#333] rounded-2xl px-6 py-4 text-lg focus:outline-none focus:border-red-600 transition-all"
                      />
                    </div>
                    <button 
                      onClick={handleSummarizeUrl}
                      disabled={isSummarizing || !videoUrl}
                      className="bg-[#e62117] hover:bg-red-600 text-white font-bold px-10 rounded-2xl transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2 shadow-xl shadow-red-600/20"
                    >
                      {isSummarizing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                      Summarize
                    </button>
                  </div>
                </section>

                {/* Latest from Subscriptions */}
                <section className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-2xl font-bold flex items-center gap-3">
                      <History className="w-6 h-6 text-red-500" />
                      Latest from Subscriptions
                    </h3>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => fetchSubscriptions(true)}
                        disabled={checking || !accessToken}
                        className="flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white bg-[#1a1a1a] px-4 py-2 rounded-xl border border-[#222] transition-all disabled:opacity-50"
                      >
                        <RefreshCw className={cn("w-3 h-3", checking && "animate-spin")} />
                        {checking ? 'Syncing...' : 'Sync Channels'}
                      </button>
                      <button 
                        onClick={() => setActiveTab('summaries')}
                        className="text-sm text-slate-500 hover:text-white transition-colors"
                      >
                        View All
                      </button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {isFetchingRecent ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="bg-[#141414] rounded-3xl overflow-hidden border border-[#222] animate-pulse">
                          <div className="aspect-video bg-slate-800" />
                          <div className="p-5 space-y-3">
                            <div className="h-4 bg-slate-800 rounded w-3/4" />
                            <div className="h-3 bg-slate-800 rounded w-1/2" />
                          </div>
                        </div>
                      ))
                    ) : (
                      recentVideos.map((video) => {
                        const videoId = video.id.videoId;
                        const isSummarized = notifications.some(n => n.videoId === videoId);
                        
                        return (
                          <motion.div 
                            key={videoId}
                            whileHover={{ y: -5 }}
                            className="bg-[#141414] rounded-3xl overflow-hidden border border-[#222] group cursor-pointer relative"
                            onClick={() => handleVideoClick(video)}
                          >
                            <div className="aspect-video bg-slate-800 relative">
                              <img 
                                src={video.snippet.thumbnails.high?.url || video.snippet.thumbnails.medium?.url} 
                                className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                                alt={video.snippet.title}
                              />
                              {isSummarized && (
                                <div className="absolute top-2 right-2 bg-green-600 text-white p-1 rounded-full shadow-lg">
                                  <CheckCircle2 className="w-3 h-3" />
                                </div>
                              )}
                            </div>
                            <div className="p-5 space-y-2">
                              <h4 className="font-bold text-sm line-clamp-2 leading-snug group-hover:text-red-500 transition-colors">{video.snippet.title}</h4>
                              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">{video.snippet.channelTitle}</p>
                            </div>
                          </motion.div>
                        );
                      })
                    )}

                    {!isFetchingRecent && recentVideos.length === 0 && (
                      <div className="col-span-full py-12 text-center bg-[#111] rounded-[32px] border border-dashed border-[#222]">
                        <p className="text-slate-500">No recent videos found. Try syncing your channels!</p>
                      </div>
                    )}
                  </div>
                </section>
              </motion.div>
            )}

            {activeTab === 'summaries' && (
              <motion.div 
                key="summaries"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-3xl font-bold">Your Summaries</h2>
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input 
                        type="text"
                        placeholder="Search summaries..."
                        className="bg-[#111] border border-[#222] rounded-xl pl-11 pr-4 py-2 text-sm focus:outline-none focus:border-red-600 transition-colors"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {notifications.map((notif) => (
                    <motion.div 
                      key={notif.id}
                      whileHover={{ y: -5 }}
                      className="bg-[#141414] rounded-3xl overflow-hidden border border-[#222] group cursor-pointer flex flex-col"
                      onClick={() => setSelectedSummary(notif)}
                    >
                      <div className="aspect-video bg-slate-800 relative">
                        <img 
                          src={`https://img.youtube.com/vi/${notif.videoId}/maxresdefault.jpg`} 
                          className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                          alt={notif.videoTitle}
                        />
                      </div>
                      <div className="p-6 flex-1 flex flex-col justify-between space-y-4">
                        <div className="space-y-2">
                          <h4 className="font-bold text-lg line-clamp-2 leading-tight group-hover:text-red-500 transition-colors">{notif.videoTitle}</h4>
                          <p className="text-xs text-slate-500 uppercase tracking-widest font-bold">{notif.channelName}</p>
                        </div>
                        <div className="flex items-center justify-between pt-4 border-t border-[#222]">
                          <span className="text-[10px] text-slate-500">{new Date(notif.publishedAt).toLocaleDateString()}</span>
                          <div className="flex items-center gap-1 text-green-500 text-[10px] font-bold">
                            <CheckCircle2 className="w-3 h-3" />
                            SYNCED
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {notifications.length === 0 && (
                  <div className="text-center py-20 bg-[#111] rounded-[40px] border border-dashed border-[#222]">
                    <History className="w-12 h-12 mx-auto mb-4 text-slate-700" />
                    <p className="text-slate-500">No summaries yet. Paste a URL or wait for new uploads!</p>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'subscriptions' && (
              <motion.div 
                key="subscriptions"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-3xl font-bold">Subscribed Channels</h2>
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input 
                        type="text"
                        placeholder="Search channels..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="bg-[#111] border border-[#222] rounded-xl pl-11 pr-4 py-2 text-sm focus:outline-none focus:border-red-600 transition-colors"
                      />
                    </div>
                    <button 
                      onClick={() => fetchSubscriptions()}
                      disabled={checking}
                      className="p-2 bg-[#1a1a1a] rounded-xl border border-[#222] hover:bg-[#222] transition-colors"
                    >
                      <RefreshCw className={cn("w-5 h-5", checking && "animate-spin")} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                  {subscriptions
                    .filter(sub => sub.snippet.title.toLowerCase().includes(searchQuery.toLowerCase()))
                    .sort((a, b) => {
                      const titleA = a.snippet.title.toLowerCase();
                      const titleB = b.snippet.title.toLowerCase();
                      return sortOrder === 'asc' ? titleA.localeCompare(titleB) : titleB.localeCompare(titleA);
                    })
                    .map((sub) => (
                    <motion.div 
                      key={sub.id}
                      whileHover={{ y: -5 }}
                      className="bg-[#141414] border border-[#222] rounded-[32px] p-6 flex flex-col items-center text-center space-y-4 group relative"
                    >
                      <div className="relative">
                        <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-[#222] group-hover:border-red-600 transition-colors">
                          <img 
                            src={sub.snippet.thumbnails.default.url} 
                            className="w-full h-full object-cover" 
                            alt={sub.snippet.title} 
                            referrerPolicy="no-referrer"
                          />
                        </div>
                        <div className="absolute bottom-1 right-1 w-6 h-6 bg-red-600 rounded-full flex items-center justify-center border-4 border-[#141414]">
                          <CheckCircle2 className="w-3 h-3 text-white" />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <h4 className="font-bold text-base line-clamp-1 group-hover:text-red-500 transition-colors">{sub.snippet.title}</h4>
                        <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Active</p>
                      </div>
                      <button className="w-full bg-[#1a1a1a] hover:bg-red-600/10 hover:text-red-500 hover:border-red-600/50 border border-[#333] py-2.5 rounded-xl text-[10px] font-bold transition-all">
                        Notifications On
                      </button>
                    </motion.div>
                  ))}
                </div>

                {nextPageToken && !searchQuery && (
                  <div className="flex justify-center pt-8">
                    <button
                      onClick={() => fetchSubscriptions(false)}
                      disabled={checking}
                      className="flex items-center gap-2 bg-[#1a1a1a] hover:bg-[#222] px-8 py-3 rounded-2xl text-sm font-bold transition-all disabled:opacity-50"
                    >
                      {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      {checking ? 'Loading...' : 'Load More Channels'}
                    </button>
                  </div>
                )}

                {subscriptions.filter(sub => sub.snippet.title.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 && (
                  <div className="text-center py-20 bg-[#111] rounded-[40px] border border-dashed border-[#222]">
                    <Search className="w-12 h-12 mx-auto mb-4 text-slate-700" />
                    <p className="text-slate-500">No channels found matching "{searchQuery}"</p>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'explore' && (
              <motion.div 
                key="explore"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h2 className="text-3xl font-bold">Explore Trending</h2>
                    <p className="text-slate-500 text-sm">Discover and summarize what's popular on YouTube right now.</p>
                  </div>
                  <button 
                    onClick={fetchExploreVideos}
                    disabled={isFetchingExplore}
                    className="p-2 bg-[#1a1a1a] rounded-xl border border-[#222] hover:bg-[#222] transition-colors"
                  >
                    <RefreshCw className={cn("w-5 h-5", isFetchingExplore && "animate-spin")} />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {isFetchingExplore ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="bg-[#141414] rounded-3xl overflow-hidden border border-[#222] animate-pulse">
                        <div className="aspect-video bg-slate-800" />
                        <div className="p-5 space-y-3">
                          <div className="h-4 bg-slate-800 rounded w-3/4" />
                          <div className="h-3 bg-slate-800 rounded w-1/2" />
                        </div>
                      </div>
                    ))
                  ) : (
                    exploreVideos.map((video) => {
                      const videoId = video.id;
                      const isSummarized = notifications.some(n => n.videoId === videoId);
                      
                      return (
                        <motion.div 
                          key={videoId}
                          whileHover={{ y: -5 }}
                          className="bg-[#141414] rounded-3xl overflow-hidden border border-[#222] group cursor-pointer relative flex flex-col"
                          onClick={() => handleVideoClick(video)}
                        >
                          <div className="aspect-video bg-slate-800 relative">
                            <img 
                              src={video.snippet.thumbnails.high?.url || video.snippet.thumbnails.medium?.url} 
                              className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                              alt={video.snippet.title}
                            />
                            <div className="absolute bottom-2 right-2 bg-black/80 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                              {formatYouTubeDuration(video.contentDetails.duration)}
                            </div>
                            {isSummarized && (
                              <div className="absolute top-2 right-2 bg-green-600 text-white p-1 rounded-full shadow-lg">
                                <CheckCircle2 className="w-3 h-3" />
                              </div>
                            )}
                          </div>
                          <div className="p-5 space-y-2 flex-1 flex flex-col justify-between">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[9px] text-slate-500 font-bold uppercase tracking-tighter">
                                  {new Date(video.snippet.publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                </span>
                              </div>
                              <h4 className="font-bold text-sm line-clamp-2 leading-snug group-hover:text-red-500 transition-colors">{video.snippet.title}</h4>
                              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mt-1">{video.snippet.channelTitle}</p>
                              <p className="text-[11px] text-slate-400 line-clamp-2 mt-2 leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity">
                                {video.snippet.description}
                              </p>
                            </div>
                            <div className="flex items-center justify-between pt-4 mt-4 border-t border-[#222]">
                              <div className="flex items-center gap-3">
                                <span className="text-[10px] text-slate-500">{parseInt(video.statistics.viewCount).toLocaleString()} views</span>
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const link = `https://www.youtube.com/watch?v=${videoId}`;
                                    navigator.clipboard.writeText(link);
                                    toast.success('Link copied to clipboard!');
                                  }}
                                  className="p-1.5 bg-[#1a1a1a] rounded-lg border border-[#222] hover:bg-[#222] hover:border-red-600/50 transition-all group/share"
                                  title="Share video"
                                >
                                  <Share2 className="w-3 h-3 text-slate-500 group-hover/share:text-red-500" />
                                </button>
                              </div>
                              <Sparkles className="w-3 h-3 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                          </div>
                        </motion.div>
                      );
                    })
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'alerts' && (
              <motion.div 
                key="alerts"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                <div className="space-y-1">
                  <h2 className="text-3xl font-bold">Recent Alerts</h2>
                  <p className="text-slate-500 text-sm">Stay updated with the latest summaries from your monitored channels.</p>
                </div>

                <div className="space-y-4">
                  {notifications.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 bg-[#111] rounded-[32px] border border-dashed border-[#222]">
                      <Bell className="w-12 h-12 text-slate-700 mb-4" />
                      <p className="text-slate-500">No alerts yet. Enable monitoring to get started.</p>
                    </div>
                  ) : (
                    notifications.map((notif) => (
                      <motion.div 
                        key={notif.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="bg-[#141414] border border-[#222] rounded-2xl p-6 flex items-center gap-6 group hover:border-red-600/50 transition-all cursor-pointer"
                        onClick={() => setSelectedSummary(notif)}
                      >
                        <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0">
                          <img 
                            src={`https://img.youtube.com/vi/${notif.videoId}/mqdefault.jpg`} 
                            className="w-full h-full object-cover" 
                            alt={notif.videoTitle} 
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest">New Upload</span>
                            <span className="text-[10px] text-slate-500">•</span>
                            <span className="text-[10px] text-slate-500">{new Date(notif.sentAt?.toDate()).toLocaleString()}</span>
                          </div>
                          <h4 className="font-bold text-base truncate group-hover:text-red-500 transition-colors">{notif.videoTitle}</h4>
                          <p className="text-xs text-slate-500">{notif.channelName}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <button className="p-2 bg-[#1a1a1a] rounded-lg border border-[#222] hover:bg-[#222] transition-colors">
                            <Play className="w-4 h-4 text-white" />
                          </button>
                        </div>
                      </motion.div>
                    ))
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div 
                key="settings"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-2xl space-y-8"
              >
                <div className="space-y-1">
                  <h2 className="text-3xl font-bold">Settings</h2>
                  <p className="text-slate-500 text-sm">Customize your summarization and notification experience.</p>
                </div>

                <div className="space-y-6">
                  {/* Notifications */}
                  <div className="bg-[#141414] border border-[#222] rounded-[32px] p-8 space-y-6">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <h4 className="font-bold text-lg">Email Notifications</h4>
                        <p className="text-sm text-slate-500">Receive an email whenever a new summary is generated.</p>
                      </div>
                      <button 
                        onClick={() => updateSettings({ ...userSettings, emailNotifications: !userSettings.emailNotifications })}
                        className={cn(
                          "w-14 h-8 rounded-full p-1 transition-all duration-300",
                          userSettings.emailNotifications ? "bg-red-600" : "bg-[#222]"
                        )}
                      >
                        <div className={cn(
                          "w-6 h-6 bg-white rounded-full shadow-md transition-all duration-300",
                          userSettings.emailNotifications ? "translate-x-6" : "translate-x-0"
                        )} />
                      </button>
                    </div>

                    <div className="pt-6 border-t border-[#222]">
                      <div className="space-y-4">
                        <div className="space-y-1">
                          <h4 className="font-bold text-lg">Summary Length</h4>
                          <p className="text-sm text-slate-500">Choose how detailed you want your AI summaries to be.</p>
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                          {(['short', 'medium', 'long'] as const).map((len) => (
                            <button
                              key={len}
                              onClick={() => updateSettings({ ...userSettings, summaryLength: len })}
                              className={cn(
                                "py-4 rounded-2xl border text-sm font-bold capitalize transition-all",
                                userSettings.summaryLength === len 
                                  ? "bg-red-600/10 border-red-600 text-red-500" 
                                  : "bg-[#1a1a1a] border-[#222] text-slate-500 hover:border-[#333]"
                              )}
                            >
                              {len}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Account Info */}
                  <div className="bg-[#141414] border border-[#222] rounded-[32px] p-8 space-y-6">
                    <h4 className="font-bold text-lg">Account Information</h4>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between py-3 border-b border-[#222]">
                        <span className="text-sm text-slate-500">Email Address</span>
                        <span className="text-sm font-medium">{user.email}</span>
                      </div>
                      <div className="flex items-center justify-between py-3 border-b border-[#222]">
                        <span className="text-sm text-slate-500">Account Status</span>
                        <span className="text-xs font-bold text-green-500 bg-green-500/10 px-2 py-1 rounded">Active</span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Summary Modal */}
      <AnimatePresence>
        {selectedSummary && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedSummary(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-3xl bg-[#141414] border border-[#222] rounded-[40px] overflow-hidden shadow-2xl"
            >
              <div className="p-8 border-b border-[#222] flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-red-600/20 rounded-xl flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-red-500" />
                  </div>
                  <div>
                    <h3 className="font-bold text-xl">AI Video Insight</h3>
                    <p className="text-xs text-slate-500">Summarized using Gemini 3 Flash</p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedSummary(null)}
                  className="p-2 hover:bg-[#222] rounded-full transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="p-8 max-h-[70vh] overflow-y-auto custom-scrollbar space-y-8">
                <div className="flex gap-6 items-start">
                  <div className="w-48 aspect-video bg-slate-800 rounded-2xl overflow-hidden shrink-0">
                    <img 
                      src={`https://img.youtube.com/vi/${selectedSummary.videoId}/maxresdefault.jpg`} 
                      className="w-full h-full object-cover"
                      alt={selectedSummary.videoTitle}
                    />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-2xl font-bold leading-tight">{selectedSummary.videoTitle}</h2>
                    <p className="text-slate-400">{selectedSummary.channelName}</p>
                  </div>
                </div>

                <div className="prose prose-invert prose-red max-w-none">
                  <ReactMarkdown>{selectedSummary.summary}</ReactMarkdown>
                </div>
              </div>

              <div className="p-8 bg-[#0a0a0a] border-t border-[#222] flex items-center justify-between">
                <div className="flex gap-3">
                  <button className="flex items-center gap-2 bg-[#1a1a1a] hover:bg-[#222] px-6 py-3 rounded-2xl text-sm font-bold transition-all">
                    <Share2 className="w-4 h-4" />
                    Share
                  </button>
                  <button className="flex items-center gap-2 bg-[#1a1a1a] hover:bg-[#222] px-6 py-3 rounded-2xl text-sm font-bold transition-all">
                    <Bookmark className="w-4 h-4" />
                    Save
                  </button>
                </div>
                <a 
                  href={selectedSummary.videoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 bg-[#e62117] hover:bg-red-600 px-8 py-3 rounded-2xl text-sm font-bold transition-all active:scale-95 shadow-lg shadow-red-600/20"
                >
                  Watch on YouTube
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Floating Action Button */}
      <button className="fixed bottom-8 right-8 w-14 h-14 bg-[#e62117] rounded-full flex items-center justify-center shadow-2xl shadow-red-600/40 hover:scale-110 active:scale-95 transition-all z-50">
        <Sparkles className="w-6 h-6 text-white" />
      </button>
    </div>
  );
}
