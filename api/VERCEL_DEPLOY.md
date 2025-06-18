# Vercel Deployment Guide

## Setup Steps

### 1. Environment Variables
In your Vercel dashboard, add these environment variables:

```
GEMINI_API_KEY=your_gemini_api_key_here
SUPABASE_URL=your_supabase_url_here
SUPABASE_ANON_KEY=your_supabase_anon_key_here
NODE_ENV=production
```

### 2. Deploy to Vercel
1. Connect your GitHub repository to Vercel
2. Vercel will automatically detect the `vercel.json` configuration
3. Deploy!

### 3. Update Flutter App
Once deployed, update your Flutter app's `.env` file with the new Vercel URL:

```
API_BASE_URL=https://your-vercel-app.vercel.app
```

## API Endpoints

- Health Check: `GET /api/health`
- Chat: `POST /api/chat`
- Conversations: `GET /api/conversations`
- Messages: `GET /api/conversations/:id/messages`
- Delete Conversation: `DELETE /api/conversations/:id`
- Models: `GET /api/models`

## Notes

- The app is configured as a serverless function
- Maximum execution time is 30 seconds
- All routes are handled by `/api/index.js`
- CORS is enabled for all origins
- Authentication is handled via Supabase JWT tokens 