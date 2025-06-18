const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// Load environment variables from the correct path
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();

// Security middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS configuration
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
app.use(morgan('combined'));

// Initialize Google Gemini AI
let model;
try {
    if (!process.env.GEMINI_API_KEY) {
        console.error('❌ GEMINI_API_KEY is required');
        process.exit(1);
    }
    
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    console.log('✅ Gemini AI initialized successfully');
} catch (error) {
    console.error('❌ Failed to initialize Gemini AI:', error);
    process.exit(1);
}

// Initialize Supabase
let supabase;
try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
        console.error('❌ SUPABASE_URL and SUPABASE_ANON_KEY are required');
        process.exit(1);
    }
    
    supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY
    );
    console.log('✅ Supabase initialized successfully');
} catch (error) {
    console.error('❌ Failed to initialize Supabase:', error);
    process.exit(1);
}

// Auth verification middleware
const verifyAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing or invalid authorization header' });
        }

        const token = authHeader.substring(7);
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        req.user = user;
        next();
    } catch (error) {
        console.error('Auth verification error:', error);
        res.status(401).json({ error: 'Authentication failed' });
    }
};

// Helper functions
const getOrCreateConversation = async (userId, conversationId = null, title = 'New Chat') => {
    try {
        if (conversationId) {
            const { data, error } = await supabase
                .from('conversations')
                .select('*')
                .eq('id', conversationId)
                .eq('user_id', userId)
                .single();

            if (!error && data) {
                return data;
            }
        }

        const { data, error } = await supabase
            .from('conversations')
            .insert({
                user_id: userId,
                title: title,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .select()
            .single();

        if (error) {
            throw error;
        }

        return data;
    } catch (error) {
        console.error('Error in getOrCreateConversation:', error);
        throw error;
    }
};

const getConversationHistory = async (conversationId, limit = 20) => {
    try {
        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: true })
            .limit(limit);

        if (error) {
            throw error;
        }

        return data || [];
    } catch (error) {
        console.error('Error fetching conversation history:', error);
        throw error;
    }
};

const saveMessage = async (conversationId, role, content) => {
    try {
        const { data, error } = await supabase
            .from('messages')
            .insert({
                conversation_id: conversationId,
                role: role,
                content: content,
                created_at: new Date().toISOString()
            })
            .select()
            .single();

        if (error) {
            throw error;
        }

        return data;
    } catch (error) {
        console.error('Error saving message:', error);
        throw error;
    }
};

// Routes
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
            gemini: !!model,
            supabase: !!supabase
        }
    });
});

app.get('/api/conversations', verifyAuth, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('conversations')
            .select('*')
            .eq('user_id', req.user.id)
            .order('updated_at', { ascending: false });

        if (error) {
            throw error;
        }

        res.json(data || []);
    } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({ error: 'Failed to fetch conversations' });
    }
});

app.get('/api/conversations/:id/messages', verifyAuth, async (req, res) => {
    try {
        const conversationId = req.params.id;
        const messages = await getConversationHistory(conversationId);
        res.json(messages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

app.post('/api/chat', verifyAuth, async (req, res) => {
    try {
        const { prompt, conversation_id, model_name = 'gemini-2.0-flash-exp' } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'Missing required parameter: prompt' });
        }

        console.log(`Chat request from user ${req.user.id}: ${prompt.substring(0, 50)}...`);

        const conversation = await getOrCreateConversation(
            req.user.id, 
            conversation_id,
            prompt.substring(0, 50) + '...'
        );

        const history = await getConversationHistory(conversation.id);
        await saveMessage(conversation.id, 'user', prompt);

        let contextMessages = [];
        history.forEach(msg => {
            if (msg.role === 'user') {
                contextMessages.push(`User: ${msg.content}`);
            } else if (msg.role === 'assistant') {
                contextMessages.push(`Assistant: ${msg.content}`);
            }
        });

        contextMessages.push(`User: ${prompt}`);

        let fullContext;
        if (history.length > 0) {
            const previousMessages = contextMessages.slice(0, -1).join('\n');
            fullContext = `Previous conversation:\n${previousMessages}\n\nCurrent message:\n${prompt}\n\nPlease respond remembering our previous conversation and maintain context.`;
        } else {
            fullContext = prompt;
        }

        console.log(`Context length: ${history.length + 1} messages`);

        const result = await model.generateContent(fullContext);
        const response = await result.response;
        const aiResponse = response.text();

        await saveMessage(conversation.id, 'assistant', aiResponse);

        if (history.length === 0) {
            await supabase
                .from('conversations')
                .update({ 
                    title: prompt.substring(0, 50) + (prompt.length > 50 ? '...' : '') 
                })
                .eq('id', conversation.id);
        }

        res.json({
            content: aiResponse,
            conversation_id: conversation.id,
            model_used: model_name
        });

    } catch (error) {
        console.error('Error in chat endpoint:', error);
        
        if (error.message && error.message.includes('API_KEY')) {
            return res.status(500).json({ 
                error: 'Invalid or missing Gemini API key. Please check your configuration.' 
            });
        }
        
        res.status(500).json({ 
            error: 'Failed to generate response. Please try again.',
            details: error.message 
        });
    }
});

app.delete('/api/conversations/:id', verifyAuth, async (req, res) => {
    try {
        const conversationId = req.params.id;

        const { error } = await supabase
            .from('conversations')
            .delete()
            .eq('id', conversationId)
            .eq('user_id', req.user.id);

        if (error) {
            throw error;
        }

        res.json({ message: 'Conversation deleted successfully' });
    } catch (error) {
        console.error('Error deleting conversation:', error);
        res.status(500).json({ error: 'Failed to delete conversation' });
    }
});

app.get('/api/models', (req, res) => {
    res.json({
        text_models: [
            { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash Experimental' },
            { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
            { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' }
        ],
        default_model: 'gemini-2.0-flash-exp'
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Export for Vercel
module.exports = app; 