# youtube-notifier-system
TubeSum AI is a full-stack application designed to help users stay updated with their favorite YouTube content without spending hours watching every video. By leveraging the power of Google's Gemini AI, it provides concise, structured summaries of any YouTube video, allowing you to grasp the core message in seconds.
🚀 Key Features
Deep AI Summarization: Generate structured summaries (Key Takeaways, Main Points, and Conclusions) for any YouTube URL using Gemini 1.5 Flash.

Automated Channel Monitoring: Automatically tracks your YouTube subscriptions and alerts you the moment a new video is uploaded.
                                            
Smart Email Notifications: Get AI-generated summaries delivered directly to your inbox so you never miss an important update.

Rich Explore Dashboard: Discover trending videos with enhanced metadata, including video duration, published dates, and description snippets.

Real-time Alerts: A dedicated alerts center to manage and view all your recent video summaries in one place.

Secure Authentication: Seamless Google Login integration via Firebase for a personalized and secure experience.

🛠️ Tech Stack

Frontend: React 19, Vite, Tailwind CSS, Framer Motion (for smooth animations)

Backend: Node.js, Express

AI: Google Gemini API (@google/genai)

Database & Auth: Firebase Firestore & Firebase Authentication

APIs: YouTube Data API v3

Notifications: Nodemailer (Email)

🛠️ Local Setup

Install dependencies: npm install

Configure Environment: Create a .env file with your GEMINI_API_KEY, EMAIL_USER, and EMAIL_PASS.

Run the app: npm run dev

