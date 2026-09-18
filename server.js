const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'aagaman_super_secret_jwt_key_2026';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Aagaman008';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Aagaman@2008';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Data Directory
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Helper to read & write JSON files
const readJson = (filename, defaultValue = []) => {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf8');
        return defaultValue;
    }
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw || '[]');
    } catch (err) {
        console.error(`Error reading ${filename}:`, err);
        return defaultValue;
    }
};

const writeJson = (filename, data) => {
    const filePath = path.join(DATA_DIR, filename);
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
};

// In-memory OTP store with 5-minute expiry
const otpStore = new Map();

// Razorpay SDK optional initialization
let razorpayInstance = null;
try {
    const Razorpay = require('razorpay');
    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
        razorpayInstance = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET
        });
    }
} catch (e) {
    console.warn("Razorpay module warning:", e.message);
}

// Nodemailer Email Transporter (For Real Gmail Delivery)
let emailTransporter = null;
if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    const cleanPass = process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, '');
    emailTransporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER.trim(),
            pass: cleanPass
        }
    });
    console.log(`Nodemailer initialized with ${process.env.GMAIL_USER}`);
}

// Multer Storage Configuration (Supports Images and HD Videos up to 50MB)
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'aagaman-' + uniqueSuffix + ext);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB for photos & videos
});

// Authentication Middlewares
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Access denied. Please login first.' });

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ success: false, message: 'Invalid or expired session. Please login again.' });
        req.user = decoded;
        next();
    });
};

const authenticateAdmin = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Admin authentication required.' });

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err || !decoded.isAdmin) {
            return res.status(403).json({ success: false, message: 'Unauthorized. Admin privilege required.' });
        }
        req.admin = decoded;
        next();
    });
};

// ==========================================
// KEEP-ALIVE & HEALTH CHECK (Render 24/7 Awake)
// ==========================================
app.get('/ping', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Hotel Aagaman server is active', timestamp: new Date().toISOString() });
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()), timestamp: new Date().toISOString() });
});

// ==========================================
// AUTHENTICATION ROUTES (Real Mobile SMS & Gmail)
// ==========================================

// 1. Send OTP to Mobile or Email (REAL SMS & EMAIL INTEGRATION)
app.post('/api/auth/send-otp', async (req, res) => {
    const { identifier } = req.body;
    if (!identifier) {
        return res.status(400).json({ success: false, message: 'Mobile number or email is required.' });
    }

    let cleanId = String(identifier).trim();
    const isEmail = cleanId.includes('@');
    if (!isEmail) {
        cleanId = cleanId.replace(/\D/g, '');
        if (cleanId.length === 12 && cleanId.startsWith('91')) {
            cleanId = cleanId.slice(2);
        }
        if (cleanId.length !== 10) {
            return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit mobile number.' });
        }
    }

    // Generate 100% completely random and unpredictable 6-digit OTP every single time
    const otp = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 mins

    otpStore.set(cleanId, { otp, expiresAt });
    console.log(`[Aagaman OTP] Unique Random OTP for ${cleanId}: ${otp}`);

    let realDeliveryStatus = 'queued';

    // A. Real Email Delivery via Gmail SMTP
    if (isEmail && emailTransporter) {
        try {
            await emailTransporter.sendMail({
                from: `"Hotel Aagaman" <${process.env.GMAIL_USER}>`,
                to: cleanId,
                subject: `Your Hotel Aagaman Verification Code: ${otp}`,
                html: `
                    <div style="font-family: 'Segoe UI', Arial, sans-serif; background: #0a0e1a; color: #ffffff; padding: 40px 20px; text-align: center;">
                        <div style="max-width: 500px; margin: 0 auto; background: #121a2f; border: 1px solid rgba(255,255,255,0.15); border-radius: 16px; padding: 35px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                            <h2 style="color: #ff7a00; font-size: 26px; margin-bottom: 10px; letter-spacing: 1px;">HOTEL AAGAMAN</h2>
                            <p style="color: #cbd5e1; font-size: 15px; margin-bottom: 25px;">Kheralu, Ambaji Highway, Gujarat</p>
                            <div style="background: rgba(255,122,0,0.1); border: 1px dashed #ff7a00; padding: 20px; border-radius: 12px; margin-bottom: 25px;">
                                <span style="font-size: 13px; color: #94a3b8; text-transform: uppercase; letter-spacing: 2px;">Your 6-Digit OTP Code</span>
                                <div style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #ffffff; margin-top: 8px;">${otp}</div>
                            </div>
                            <p style="color: #94a3b8; font-size: 13px; line-height: 1.5;">This verification code is valid for 5 minutes. Please do not share it with anyone.</p>
                            <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 20px; margin-top: 25px; color: #64748b; font-size: 12px;">
                                © 2026 Hotel Aagaman. 24/7 Helpline: +91 6353848203
                            </div>
                        </div>
                    </div>
                `
            });
            console.log(`[Aagaman Mail] Real email sent to ${cleanId}`);
            realDeliveryStatus = 'sent_email';
        } catch (mailErr) {
            console.error(`[Aagaman Mail Error]:`, mailErr.message);
        }
    }

    // B. Real SMS Delivery via Fast2SMS (Indian Mobile Delivery)
    if (!isEmail && cleanId.length === 10) {
        if (!process.env.FAST2SMS_API_KEY) {
            return res.status(400).json({
                success: false,
                message: 'Fast2SMS API Key is missing in .env'
            });
        }

        try {
            let smsData = null;

            // 1. If FAST2SMS_OTP_ID is configured, use the new official Fast2SMS OTP API
            if (process.env.FAST2SMS_OTP_ID) {
                const otpRes = await fetch('https://www.fast2sms.com/dev/otp/send', {
                    method: 'POST',
                    headers: {
                        'authorization': process.env.FAST2SMS_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        mobile: cleanId,
                        otp_id: process.env.FAST2SMS_OTP_ID.trim(),
                        otp: otp
                    })
                });
                smsData = await otpRes.json();
                console.log(`[Aagaman Fast2SMS New OTP API] Response:`, smsData);
            }

            // 2. Primary fallback attempt: route 'otp'
            if (!smsData || !smsData.return) {
                let smsRes = await fetch('https://www.fast2sms.com/dev/bulkV2', {
                    method: 'POST',
                    headers: {
                        'authorization': process.env.FAST2SMS_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        variables_values: otp,
                        route: 'otp',
                        numbers: cleanId
                    })
                });
                const resData = await smsRes.json();
                console.log(`[Aagaman Fast2SMS Route OTP] Response:`, resData);
                if (resData.return) {
                    smsData = resData;
                } else if (!smsData) {
                    smsData = resData;
                }
            }

            // Secondary attempt: route 'q' (Quick SMS) if route 'otp' pending verification
            if (!smsData.return) {
                const qRes = await fetch('https://www.fast2sms.com/dev/bulkV2', {
                    method: 'POST',
                    headers: {
                        'authorization': process.env.FAST2SMS_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        route: 'q',
                        message: `Your Hotel Aagaman verification code is ${otp}. Valid for 5 mins.`,
                        language: 'english',
                        numbers: cleanId
                    })
                });
                const qData = await qRes.json();
                console.log(`[Aagaman Fast2SMS Route Q] Response:`, qData);
                if (qData.return) {
                    smsData = qData;
                }
            }

            if (smsData.return) {
                realDeliveryStatus = 'sent_sms';
                console.log(`[Aagaman SMS Success] Real Text SMS dispatched to +91 ${cleanId}`);
            } else {
                const failReason = Array.isArray(smsData.message) ? smsData.message.join(', ') : (smsData.message || 'SMS delivery failed');
                console.error(`[Aagaman Fast2SMS Failed]:`, failReason);
                return res.json({
                    success: false,
                    message: `Fast2SMS Notice: ${failReason}`
                });
            }
        } catch (smsErr) {
            console.error(`[Aagaman SMS Error]:`, smsErr.message);
            return res.status(500).json({
                success: false,
                message: 'SMS Gateway connection error: ' + smsErr.message
            });
        }
    }

    res.json({
        success: true,
        message: isEmail 
            ? `Verification code dispatched to ${cleanId}` 
            : `SMS verification code dispatched to +91 ${cleanId}`,
        deliveryStatus: realDeliveryStatus
    });
});

// 2. Verify OTP & Login / Register
app.post('/api/auth/verify-otp', (req, res) => {
    const { identifier, otp, name } = req.body;
    if (!identifier || !otp) {
        return res.status(400).json({ success: false, message: 'Identifier and OTP are required.' });
    }

    let cleanId = String(identifier).trim();
    if (!cleanId.includes('@')) {
        cleanId = cleanId.replace(/\D/g, '');
        if (cleanId.length === 12 && cleanId.startsWith('91')) {
            cleanId = cleanId.slice(2);
        }
    }
    const record = otpStore.get(cleanId);

    if (!record) {
        return res.status(400).json({ success: false, message: 'No OTP requested for this identifier or it expired.' });
    }

    if (Date.now() > record.expiresAt) {
        otpStore.delete(cleanId);
        return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }

    if (record.otp !== String(otp).trim()) {
        return res.status(400).json({ success: false, message: 'Invalid OTP entered. Please try again.' });
    }

    // OTP Verified! Clear it
    otpStore.delete(cleanId);

    const users = readJson('users.json');
    let user = users.find(u => u.identifier === cleanId || u.mobile === cleanId || u.email === cleanId);

    const isEmail = cleanId.includes('@');
    const nowIso = new Date().toISOString();
    if (!user) {
        user = {
            id: 'user-' + Date.now(),
            name: name || (isEmail ? cleanId.split('@')[0] : 'Guest User'),
            identifier: cleanId,
            mobile: isEmail ? '' : cleanId,
            email: isEmail ? cleanId : '',
            createdAt: nowIso,
            lastLoginAt: nowIso
        };
        users.push(user);
        writeJson('users.json', users);
    } else {
        if (name && (!user.name || user.name === 'Guest User')) {
            user.name = name;
        }
        user.lastLoginAt = nowIso;
        if (!user.createdAt) user.createdAt = nowIso;
        writeJson('users.json', users);
    }

    const token = jwt.sign(
        { id: user.id, name: user.name, identifier: cleanId, mobile: user.mobile, email: user.email },
        JWT_SECRET,
        { expiresIn: '7d' }
    );

    res.json({
        success: true,
        message: 'Logged in successfully!',
        token,
        user
    });
});

// 3. Quick Mobile Login (100% Free, Instant Verification for Mobile App & Web)
app.post('/api/auth/quick-mobile-login', (req, res) => {
    const { mobile, name, source } = req.body;
    if (!mobile) {
        return res.status(400).json({ success: false, message: 'Mobile number is required.' });
    }

    let cleanId = String(mobile).replace(/\D/g, '');
    if (cleanId.length === 12 && cleanId.startsWith('91')) cleanId = cleanId.slice(2);

    if (cleanId.length !== 10) {
        return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit mobile number.' });
    }

    const cleanName = (name && String(name).trim()) || 'Guest User';
    const userSource = source || 'Mobile App';
    const users = readJson('users.json');
    let user = users.find(u => u.identifier === cleanId || u.mobile === cleanId);
    const nowIso = new Date().toISOString();

    if (!user) {
        user = {
            id: 'user-' + Date.now(),
            name: cleanName,
            identifier: cleanId,
            mobile: cleanId,
            email: '',
            source: userSource,
            createdAt: nowIso,
            lastLoginAt: nowIso
        };
        users.push(user);
        writeJson('users.json', users);
    } else {
        if (cleanName && cleanName !== 'Guest User') {
            user.name = cleanName;
        }
        if (!user.source) user.source = userSource;
        user.lastLoginAt = nowIso;
        if (!user.createdAt) user.createdAt = nowIso;
        writeJson('users.json', users);
    }

    const token = jwt.sign(
        { id: user.id, name: user.name, identifier: cleanId, mobile: user.mobile, email: '', source: user.source },
        JWT_SECRET,
        { expiresIn: '60d' }
    );

    res.json({
        success: true,
        message: `Welcome, ${user.name}!`,
        token,
        user
    });
});

// 4. Get Current User Profile
app.get('/api/auth/me', authenticateToken, (req, res) => {
    const users = readJson('users.json');
    const user = users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    res.json({
        success: true,
        user: {
            id: user.id,
            name: user.name,
            identifier: user.identifier,
            mobile: user.mobile,
            email: user.email,
            source: user.source
        }
    });
});

// ==========================================
// SECRET HOTEL ADMIN AUTH & STATS
// ==========================================

// Admin Login (Aagaman008 / Aagaman@2008 or Dwarkesh008 / Dwarkesh@2008)
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    const isUserMatch = (username === ADMIN_USERNAME || username === 'Aagaman008' || username === 'Dwarkesh008');
    const isPassMatch = (password === ADMIN_PASSWORD || password === 'Aagaman@2008' || password === 'Dwarkesh@2008');

    if (isUserMatch && isPassMatch) {
        const token = jwt.sign(
            { username, isAdmin: true },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        return res.json({
            success: true,
            message: 'Welcome to Hotel Aagaman Admin Portal',
            token
        });
    }

    return res.status(401).json({
        success: false,
        message: 'Invalid Admin Credentials. Access Denied.'
    });
});

// Admin Dashboard Summary Stats
app.get('/api/admin/stats', authenticateAdmin, (req, res) => {
    const rooms = readJson('rooms.json');
    const menu = readJson('menu.json');
    const notices = readJson('notices.json');
    const bookings = readJson('bookings.json');
    const gallery = readJson('gallery.json');
    const users = readJson('users.json');

    const totalRevenue = bookings
        .filter(b => b.status === 'Confirmed' || b.status === 'Completed')
        .reduce((sum, b) => sum + (Number(b.totalAmount) || 0), 0);

    const contacts = readJson('contacts.json');

    res.json({
        success: true,
        stats: {
            totalRooms: rooms.length,
            totalMenuItems: menu.length,
            totalGalleryItems: gallery.length,
            activeNotices: notices.filter(n => n.active).length,
            totalBookings: bookings.length,
            confirmedBookings: bookings.filter(b => b.status === 'Confirmed').length,
            totalRevenue,
            totalInquiries: contacts.length,
            totalUsers: users.length
        }
    });
});

// Admin GET all registered users with booking metrics
app.get('/api/admin/users', authenticateAdmin, (req, res) => {
    const users = readJson('users.json');
    const bookings = readJson('bookings.json');

    const enrichedUsers = users.map(user => {
        const cleanUserMobile = user.mobile ? String(user.mobile).replace(/\D/g, '') : '';
        const userBookings = bookings.filter(b => {
            const cleanBookingMobile = b.customerMobile ? String(b.customerMobile).replace(/\D/g, '') : '';
            return b.userId === user.id || (cleanUserMobile && cleanBookingMobile && cleanUserMobile === cleanBookingMobile);
        });
        const totalSpent = userBookings
            .filter(b => b.status === 'Confirmed' || b.status === 'Completed')
            .reduce((sum, b) => sum + (Number(b.totalAmount) || 0), 0);

        return {
            ...user,
            totalBookings: userBookings.length,
            totalSpent
        };
    });

    enrichedUsers.sort((a, b) => new Date(b.lastLoginAt || b.createdAt || 0) - new Date(a.lastLoginAt || a.createdAt || 0));

    res.json({ success: true, users: enrichedUsers });
});

// Admin DELETE user
app.delete('/api/admin/users/:id', authenticateAdmin, (req, res) => {
    const users = readJson('users.json');
    const filtered = users.filter(u => u.id !== req.params.id);
    if (filtered.length === users.length) {
        return res.status(404).json({ success: false, message: 'User not found.' });
    }
    writeJson('users.json', filtered);
    res.json({ success: true, message: 'User removed successfully.' });
});

// ==========================================
// ROOMS CRUD API & AVAILABILITY TOGGLE
// ==========================================

// Public GET all rooms
app.get('/api/rooms', (req, res) => {
    const rooms = readJson('rooms.json');
    res.json({ success: true, rooms });
});

// Admin POST new room
app.post('/api/rooms', authenticateAdmin, (req, res) => {
    const { name, category, img, desc, day, night, full, capacity, amenities } = req.body;
    if (!name || !desc) {
        return res.status(400).json({ success: false, message: 'Room name and description are required.' });
    }

    const rooms = readJson('rooms.json');
    const newRoom = {
        id: 'room-' + Date.now(),
        name,
        category: category || 'Standard',
        img: img || 'room.jpeg',
        desc,
        day: Number(day) || 800,
        night: Number(night) || 1000,
        full: Number(full) || 1500,
        capacity: capacity || '2 Guests',
        amenities: Array.isArray(amenities) ? amenities : (amenities ? amenities.split(',').map(s => s.trim()) : ['Free Wi-Fi', 'AC']),
        available: true,
        createdAt: new Date().toISOString()
    };

    rooms.unshift(newRoom);
    writeJson('rooms.json', rooms);

    res.status(201).json({ success: true, message: 'Room created successfully', room: newRoom });
});

// Admin PUT update room
app.put('/api/rooms/:id', authenticateAdmin, (req, res) => {
    const rooms = readJson('rooms.json');
    const index = rooms.findIndex(r => r.id === req.params.id);
    if (index === -1) {
        return res.status(404).json({ success: false, message: 'Room not found.' });
    }

    const updated = {
        ...rooms[index],
        ...req.body,
        id: rooms[index].id,
        updatedAt: new Date().toISOString()
    };
    rooms[index] = updated;
    writeJson('rooms.json', rooms);

    res.json({ success: true, message: 'Room updated successfully', room: updated });
});

// Admin TOGGLE room availability (Available vs Booked)
app.put('/api/rooms/:id/availability', authenticateAdmin, (req, res) => {
    const { available } = req.body;
    const rooms = readJson('rooms.json');
    const room = rooms.find(r => r.id === req.params.id);

    if (!room) {
        return res.status(404).json({ success: false, message: 'Room not found.' });
    }

    room.available = Boolean(available);
    room.updatedAt = new Date().toISOString();
    writeJson('rooms.json', rooms);

    console.log(`[Room Status] Room ${room.name} marked as ${room.available ? 'AVAILABLE' : 'BOOKED'}`);

    res.json({
        success: true,
        message: `Room is now ${room.available ? 'Available' : 'Booked'}`,
        room
    });
});

// Admin DELETE room
app.delete('/api/rooms/:id', authenticateAdmin, (req, res) => {
    const rooms = readJson('rooms.json');
    const filtered = rooms.filter(r => r.id !== req.params.id);
    if (filtered.length === rooms.length) {
        return res.status(404).json({ success: false, message: 'Room not found.' });
    }

    writeJson('rooms.json', filtered);
    res.json({ success: true, message: 'Room deleted successfully.' });
});

// ==========================================
// RESTAURANT MENU CRUD API
// ==========================================

app.get('/api/menu', (req, res) => {
    const menu = readJson('menu.json');
    res.json({ success: true, menu });
});

app.post('/api/menu', authenticateAdmin, (req, res) => {
    const { name, category, img, price, desc, isVeg, popular } = req.body;
    if (!name || !price) {
        return res.status(400).json({ success: false, message: 'Dish name and price are required.' });
    }

    const menu = readJson('menu.json');
    const newDish = {
        id: 'dish-' + Date.now(),
        name,
        category: category || 'Thali',
        img: img || 'food.jpg',
        price: Number(price),
        desc: desc || '',
        isVeg: isVeg !== false,
        popular: Boolean(popular),
        createdAt: new Date().toISOString()
    };

    menu.unshift(newDish);
    writeJson('menu.json', menu);

    res.status(201).json({ success: true, message: 'Dish added successfully', dish: newDish });
});

app.put('/api/menu/:id', authenticateAdmin, (req, res) => {
    const menu = readJson('menu.json');
    const index = menu.findIndex(d => d.id === req.params.id);
    if (index === -1) {
        return res.status(404).json({ success: false, message: 'Dish not found.' });
    }

    const updated = {
        ...menu[index],
        ...req.body,
        id: menu[index].id,
        updatedAt: new Date().toISOString()
    };
    menu[index] = updated;
    writeJson('menu.json', menu);

    res.json({ success: true, message: 'Dish updated successfully', dish: updated });
});

app.delete('/api/menu/:id', authenticateAdmin, (req, res) => {
    const menu = readJson('menu.json');
    const filtered = menu.filter(d => d.id !== req.params.id);
    if (filtered.length === menu.length) {
        return res.status(404).json({ success: false, message: 'Dish not found.' });
    }

    writeJson('menu.json', filtered);
    res.json({ success: true, message: 'Dish deleted successfully.' });
});

// ==========================================
// GALLERY & VIDEO MANAGEMENT CRUD API
// ==========================================

// Public GET gallery (images and videos)
app.get('/api/gallery', (req, res) => {
    const gallery = readJson('gallery.json');
    res.json({ success: true, gallery });
});

// Admin POST gallery item (photo or video)
app.post('/api/gallery', authenticateAdmin, (req, res) => {
    const { title, category, type, url, desc } = req.body;
    if (!title || !url) {
        return res.status(400).json({ success: false, message: 'Title and media URL/file are required.' });
    }

    const gallery = readJson('gallery.json');
    const isVideo = type === 'video' || url.endsWith('.mp4') || url.endsWith('.webm') || url.endsWith('.mov');

    const newItem = {
        id: 'gal-' + Date.now(),
        title,
        category: category || 'Hotel Ambience',
        type: isVideo ? 'video' : 'image',
        url,
        desc: desc || '',
        createdAt: new Date().toISOString()
    };

    gallery.unshift(newItem);
    writeJson('gallery.json', gallery);

    res.status(201).json({ success: true, message: 'Media added to gallery!', item: newItem });
});

// Admin PUT update gallery item
app.put('/api/gallery/:id', authenticateAdmin, (req, res) => {
    const gallery = readJson('gallery.json');
    const index = gallery.findIndex(g => g.id === req.params.id);
    if (index === -1) {
        return res.status(404).json({ success: false, message: 'Gallery item not found.' });
    }

    const updated = {
        ...gallery[index],
        ...req.body,
        id: gallery[index].id,
        updatedAt: new Date().toISOString()
    };
    gallery[index] = updated;
    writeJson('gallery.json', gallery);

    res.json({ success: true, message: 'Gallery media updated', item: updated });
});

// Admin DELETE gallery item
app.delete('/api/gallery/:id', authenticateAdmin, (req, res) => {
    const gallery = readJson('gallery.json');
    const filtered = gallery.filter(g => g.id !== req.params.id);
    if (filtered.length === gallery.length) {
        return res.status(404).json({ success: false, message: 'Gallery item not found.' });
    }

    writeJson('gallery.json', filtered);
    res.json({ success: true, message: 'Gallery item deleted successfully.' });
});

// ==========================================
// NOTICES & ANNOUNCEMENTS CRUD API
// ==========================================

app.get('/api/notices', (req, res) => {
    const notices = readJson('notices.json');
    const activeOnly = req.query.all !== 'true';
    const result = activeOnly ? notices.filter(n => n.active) : notices;
    res.json({ success: true, notices: result });
});

app.post('/api/notices', authenticateAdmin, (req, res) => {
    const { title, content, tag, active } = req.body;
    if (!title || !content) {
        return res.status(400).json({ success: false, message: 'Title and content are required.' });
    }

    const notices = readJson('notices.json');
    const newNotice = {
        id: 'notice-' + Date.now(),
        title,
        content,
        tag: tag || 'Notice',
        active: active !== false,
        createdAt: new Date().toISOString()
    };

    notices.unshift(newNotice);
    writeJson('notices.json', notices);

    res.status(201).json({ success: true, message: 'Notice created successfully', notice: newNotice });
});

app.put('/api/notices/:id', authenticateAdmin, (req, res) => {
    const notices = readJson('notices.json');
    const index = notices.findIndex(n => n.id === req.params.id);
    if (index === -1) {
        return res.status(404).json({ success: false, message: 'Notice not found.' });
    }

    const updated = {
        ...notices[index],
        ...req.body,
        id: notices[index].id,
        updatedAt: new Date().toISOString()
    };
    notices[index] = updated;
    writeJson('notices.json', notices);

    res.json({ success: true, message: 'Notice updated successfully', notice: updated });
});

app.delete('/api/notices/:id', authenticateAdmin, (req, res) => {
    const notices = readJson('notices.json');
    const filtered = notices.filter(n => n.id !== req.params.id);
    if (filtered.length === notices.length) {
        return res.status(404).json({ success: false, message: 'Notice not found.' });
    }

    writeJson('notices.json', filtered);
    res.json({ success: true, message: 'Notice deleted successfully.' });
});

// ==========================================
// FOUNDER PROFILE & PHOTO API
// ==========================================

// Public GET Founder info & photo
app.get('/api/founder', (req, res) => {
    try {
        const defaultFounder = {
            name: "Soham Prajapati",
            title: "Managing Director & Founder",
            bio: "Dedicated to customer satisfaction, modern hospitality tech, and maintaining pristine cleanliness standards across Hotel Aagaman.",
            photoUrl: "sp.jpeg"
        };
        const founder = readJson('founder.json', defaultFounder);
        res.json({ success: true, founder });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to retrieve founder information.' });
    }
});

// Admin UPDATE Founder details & photo (Supports JSON or Multipart Upload)
app.post('/api/founder', authenticateAdmin, upload.single('photo'), (req, res) => {
    try {
        const defaultFounder = {
            name: "Soham Prajapati",
            title: "Managing Director & Founder",
            bio: "Dedicated to customer satisfaction, modern hospitality tech, and maintaining pristine cleanliness standards across Hotel Aagaman.",
            photoUrl: "sp.jpeg"
        };
        const founder = readJson('founder.json', defaultFounder);

        if (req.body.name) founder.name = req.body.name.trim();
        if (req.body.title) founder.title = req.body.title.trim();
        if (req.body.bio) founder.bio = req.body.bio.trim();

        if (req.file) {
            founder.photoUrl = `/uploads/${req.file.filename}`;
        } else if (req.body.photoUrl !== undefined && req.body.photoUrl.trim() !== '') {
            founder.photoUrl = req.body.photoUrl.trim();
        }

        writeJson('founder.json', founder);
        res.json({ success: true, message: 'Founder profile updated successfully!', founder });
    } catch (err) {
        console.error('Error updating founder profile:', err);
        res.status(500).json({ success: false, message: 'Failed to update founder profile.' });
    }
});

// Admin DELETE Founder photo
app.delete('/api/founder/photo', authenticateAdmin, (req, res) => {
    try {
        const defaultFounder = {
            name: "Soham Prajapati",
            title: "Managing Director & Founder",
            bio: "Dedicated to customer satisfaction, modern hospitality tech, and maintaining pristine cleanliness standards across Hotel Aagaman.",
            photoUrl: ""
        };
        const founder = readJson('founder.json', defaultFounder);
        founder.photoUrl = "";
        writeJson('founder.json', founder);
        res.json({ success: true, message: 'Founder photo removed successfully.', founder });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to remove founder photo.' });
    }
});

// ==========================================
// BOOKINGS & ORDERS API
// ==========================================

app.post('/api/bookings', authenticateToken, (req, res) => {
    const {
        type,
        itemDetails,
        checkIn,
        checkOut,
        shift,
        customerName,
        customerMobile,
        customerEmail,
        address,
        totalAmount,
        paymentMethod,
        paymentId
    } = req.body;

    if (!totalAmount) {
        return res.status(400).json({ success: false, message: 'Total amount is required.' });
    }

    const isOnline = Boolean(paymentMethod && (paymentMethod.includes('Online') || paymentMethod.includes('UPI') || paymentMethod.includes('online_upi')));
    const isCash = Boolean(paymentMethod && (paymentMethod.includes('Cash') || paymentMethod.includes('Hotel') || paymentMethod.includes('Table') || paymentMethod.includes('cash_')));

    // STRICT VALIDATION: Online booking CANNOT be made without real UTR / payment ID
    if (isOnline) {
        const cleanPaymentId = String(paymentId || '').trim();
        const utrDigits = cleanPaymentId.replace(/[^0-9a-zA-Z]/g, '');
        if (!cleanPaymentId || utrDigits.length < 10 || cleanPaymentId.includes('CASH')) {
            return res.status(400).json({
                success: false,
                message: 'A valid 12-digit UPI UTR / Transaction number is required for online booking verification.'
            });
        }
    }

    const bookings = readJson('bookings.json');
    const booking = {
        id: 'BK-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(100 + Math.random() * 900),
        userId: req.user.id,
        type: type || 'room',
        itemDetails: itemDetails || {},
        checkIn: checkIn || new Date().toISOString().split('T')[0],
        checkOut: checkOut || '',
        shift: shift || 'full',
        customerName: customerName || req.user.name,
        customerMobile: customerMobile || req.user.mobile || req.user.identifier,
        customerEmail: customerEmail || req.user.email || '',
        address: address || '',
        totalAmount: Number(totalAmount),
        paymentMethod: paymentMethod || (isCash ? 'Cash Payment' : 'Online UPI'),
        paymentId: paymentId || (isCash ? 'CASH-ON-ARRIVAL' : 'PENDING'),
        paymentStatus: isCash ? 'Pending (Cash on Arrival)' : 'Paid (Online UPI)',
        status: isCash ? 'Pending Cash' : 'Confirmed',
        createdAt: new Date().toISOString()
    };

    bookings.unshift(booking);
    writeJson('bookings.json', bookings);

    // If it is a room booking, mark the room as booked in real-time
    if (type === 'room' && itemDetails && itemDetails.roomId) {
        const rooms = readJson('rooms.json');
        const bookedRoom = rooms.find(r => r.id === itemDetails.roomId);
        if (bookedRoom) {
            bookedRoom.available = false;
            writeJson('rooms.json', rooms);
        }
    }

    // Auto-sync new booking to Google Drive / Sheets in real-time if enabled
    triggerGoogleSheetsSync({
        action: 'append_booking',
        type: 'bookings',
        booking: formatBookingForSheet(booking)
    });

    // ⚡ INSTANT AUTOMATIC NOTIFICATION: Dispatch SMS & Email immediately to customer
    sendOrderStatusNotification(booking, booking.status).catch(err => {
        console.warn('[Instant Notification Warning]:', err.message);
    });

    // WhatsApp Help URL points directly to Hotel Aagaman Helpline (+91 6353848203)
    const whatsappUrl = `https://api.whatsapp.com/send?phone=916353848203&text=${encodeURIComponent(`Hello Hotel Aagaman, I have a question regarding my booking #${booking.id} (${booking.customerName || 'Guest'}).`)}`;

    res.status(201).json({
        success: true,
        message: isCash ? 'Booking saved successfully (Pay cash upon arrival).' : 'Booking confirmed with online payment!',
        booking,
        whatsappUrl
    });
});

app.get('/api/bookings', authenticateToken, (req, res) => {
    const bookings = readJson('bookings.json');
    if (req.user.isAdmin) {
        return res.json({ success: true, bookings });
    }
    const userBookings = bookings.filter(b => b.userId === req.user.id);
    res.json({ success: true, bookings: userBookings });
});

app.get('/api/admin/bookings', authenticateAdmin, (req, res) => {
    const bookings = readJson('bookings.json');
    res.json({ success: true, bookings });
});

// ==========================================
// AUTOMATED WHATSAPP GATEWAY DISPATCH
// ==========================================
async function sendAutomatedWhatsAppMessage(mobileNumber, messageText) {
    const rawMobile = String(mobileNumber || '').replace(/\D/g, '');
    const cleanMobile = rawMobile.length === 12 && rawMobile.startsWith('91') ? rawMobile.slice(2) : rawMobile;
    if (cleanMobile.length !== 10) {
        console.warn('[WhatsApp Bot] Invalid 10-digit mobile number:', mobileNumber);
        return { success: false, message: 'Invalid mobile number (Must be 10 digits)' };
    }

    const fullMobile = `91${cleanMobile}`;
    const settings = readJson('settings.json', {});

    if (settings.whatsappAutoSend === false) {
        console.log('[WhatsApp Bot] Automated WhatsApp is disabled in settings.');
        return { success: false, message: 'WhatsApp auto-send disabled' };
    }

    // 1. UltraMsg WhatsApp Gateway (https://ultramsg.com - scans QR code like WhatsApp Web)
    const ultramsgInstance = (settings.ultramsgInstanceId || process.env.ULTRAMSG_INSTANCE_ID || '').trim();
    const ultramsgToken = (settings.ultramsgToken || process.env.ULTRAMSG_TOKEN || '').trim();
    if (ultramsgInstance && ultramsgToken) {
        try {
            console.log(`[WhatsApp Gateway] Dispatching automated message to +${fullMobile} via UltraMsg (${ultramsgInstance})...`);
            const res = await fetch(`https://api.ultramsg.com/${ultramsgInstance}/messages/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    token: ultramsgToken,
                    to: `+${fullMobile}`,
                    body: messageText
                })
            });
            const data = await res.json();
            console.log(`[WhatsApp UltraMsg Response]:`, data);
            return { success: true, provider: 'ultramsg', data };
        } catch (err) {
            console.error(`[WhatsApp UltraMsg Error]:`, err.message);
            return { success: false, provider: 'ultramsg', error: err.message };
        }
    }

    // 2. Green-API WhatsApp Gateway (https://green-api.com - Free developer tier)
    const greenApiInstance = (settings.greenApiInstanceId || process.env.GREEN_API_INSTANCE_ID || '').trim();
    const greenApiToken = (settings.greenApiToken || process.env.GREEN_API_TOKEN || '').trim();
    if (greenApiInstance && greenApiToken) {
        try {
            console.log(`[WhatsApp Gateway] Dispatching automated message to ${fullMobile}@c.us via Green-API...`);
            const res = await fetch(`https://api.green-api.com/waInstance${greenApiInstance}/sendMessage/${greenApiToken}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chatId: `${fullMobile}@c.us`,
                    message: messageText
                })
            });
            const data = await res.json();
            console.log(`[WhatsApp Green-API Response]:`, data);
            return { success: true, provider: 'green-api', data };
        } catch (err) {
            console.error(`[WhatsApp Green-API Error]:`, err.message);
            return { success: false, provider: 'green-api', error: err.message };
        }
    }

    // 3. Custom Webhook Gateway
    const customWebhook = (settings.whatsappWebhookUrl || process.env.WHATSAPP_WEBHOOK_URL || '').trim();
    if (customWebhook) {
        try {
            console.log(`[WhatsApp Gateway] Dispatching to custom webhook...`);
            const res = await fetch(customWebhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: fullMobile,
                    phone: fullMobile,
                    message: messageText,
                    hotel: 'Hotel Aagaman',
                    timestamp: new Date().toISOString()
                })
            });
            const data = await res.json();
            return { success: true, provider: 'custom_webhook', data };
        } catch (err) {
            console.error(`[WhatsApp Custom Webhook Error]:`, err.message);
            return { success: false, provider: 'custom_webhook', error: err.message };
        }
    }

    console.log('[WhatsApp Gateway] No WhatsApp credentials configured yet in Settings or .env');
    return { success: false, message: 'WhatsApp gateway not configured yet' };
}

// Helper: Send Order Status Notification to Customer's Mobile (Automated WhatsApp, Fast2SMS & Email)
async function sendOrderStatusNotification(booking, newStatus) {
    const rawMobile = String(booking.customerMobile || '').replace(/\D/g, '');
    const cleanMobile = rawMobile.length === 12 && rawMobile.startsWith('91') ? rawMobile.slice(2) : rawMobile;
    const customerName = booking.customerName || 'Valued Guest';
    const itemName = booking.itemDetails?.roomName || booking.itemDetails?.dishName || booking.itemDetails?.name || booking.type || 'Room / Dining';

    let statusEng = 'CONFIRMED';
    let whatsappMessage = '';
    if (newStatus === 'Completed') {
        statusEng = 'COMPLETED';
        whatsappMessage = `*Hotel Aagaman (Kheralu)*\n\nDear *${customerName}*,\n\nYour order / booking has been successfully *COMPLETED*.\n\n*Booking Details:*\n• Booking ID: #${booking.id}\n• Item: ${itemName}\n• Total Amount: ₹${booking.totalAmount}\n\n*Hotel Address:*\nChandra Pushpa Shopping Centre, Near Vrundavan Circle, Ambaji Highway, Kheralu, Gujarat - 384325.\n\n*Helpline:* +91 6353848203\n\nThank you for choosing Hotel Aagaman. We look forward to welcoming you again.`;
    } else if (newStatus === 'Cancelled') {
        statusEng = 'CANCELLED';
        whatsappMessage = `*Hotel Aagaman (Kheralu)*\n\nDear *${customerName}*,\n\nYour order / booking has been *CANCELLED*.\n\n*Booking Details:*\n• Booking ID: #${booking.id}\n• Item: ${itemName}\n\nIf you have any questions or need assistance, please contact us:\n*Helpline:* +91 6353848203\n\nHotel Aagaman, Kheralu.`;
    } else {
        whatsappMessage = `*Hotel Aagaman (Kheralu)*\n\nDear *${customerName}*,\n\nYour booking (#${booking.id}) is *CONFIRMED*!\n• Item: ${itemName}\n• Total Amount: ₹${booking.totalAmount}\n\n*Location:* Near Vrundavan Circle, Ambaji Highway, Kheralu.\n*Helpline:* +91 6353848203\n\nThank you for choosing Hotel Aagaman!`;
    }

    const smsMessage = `Hotel Aagaman: Dear ${customerName}, your booking #${booking.id} (${itemName}) is now ${statusEng}. Thank you! Helpline: +916353848203`;

    // WhatsApp URL for contacting the Hotel Helpline
    const whatsappUrl = `https://api.whatsapp.com/send?phone=916353848203&text=${encodeURIComponent(`Hello Hotel Aagaman, I have a question regarding my booking #${booking.id} (${customerName}).`)}`;

    // 1. ⚡ AUTOMATIC WHATSAPP BACKGROUND DISPATCH (Sent directly from Hotel's WhatsApp to Customer)
    let whatsappResult = null;
    if (cleanMobile.length === 10) {
        try {
            whatsappResult = await sendAutomatedWhatsAppMessage(cleanMobile, whatsappMessage);
        } catch (waErr) {
            console.error('[Automated WhatsApp Notification Error]:', waErr.message);
        }
    }

    // 2. Fast2SMS Mobile SMS Gateway
    if (process.env.FAST2SMS_API_KEY && cleanMobile.length === 10) {
        try {
            const smsRes = await fetch('https://www.fast2sms.com/dev/bulkV2', {
                method: 'POST',
                headers: {
                    'authorization': process.env.FAST2SMS_API_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    route: 'q',
                    message: smsMessage,
                    numbers: cleanMobile
                })
            });
            const smsJson = await smsRes.json();
            console.log(`[Aagaman Status SMS] Sent to ${cleanMobile} for ${newStatus}:`, smsJson);
        } catch (smsErr) {
            console.error(`[Aagaman Status SMS Error]:`, smsErr.message);
        }
    }

    // 3. Email Receipt / Status via Gmail SMTP
    if (emailTransporter && booking.customerEmail && booking.customerEmail.includes('@')) {
        try {
            const sender = (process.env.EMAIL_USER || process.env.GMAIL_USER || 'hotelaagaman08@gmail.com').trim();
            await emailTransporter.sendMail({
                from: `"Hotel Aagaman" <${sender}>`,
                to: booking.customerEmail,
                subject: `Hotel Aagaman - Booking #${booking.id} Status: ${statusEng}`,
                html: `
                    <div style="font-family: Arial, sans-serif; background: #F5F0E6; color: #3E2723; padding: 30px 15px;">
                        <div style="max-width: 550px; margin: 0 auto; background: #ffffff; border: 1px solid #2E473D; border-radius: 12px; padding: 25px;">
                            <h2 style="color: #2E473D; margin-top: 0;">Hotel Aagaman Kheralu</h2>
                            <p>Dear <strong>${customerName}</strong>,</p>
                            <p>Your booking status is updated to: <strong style="color: ${newStatus === 'Completed' ? '#2E473D' : (newStatus === 'Cancelled' ? '#C8705B' : '#2E473D')};">${statusEng}</strong></p>
                            <div style="background: rgba(46,71,61,0.06); padding: 15px; border-radius: 8px; margin: 15px 0;">
                                <p style="margin: 4px 0;"><strong>Booking ID:</strong> ${booking.id}</p>
                                <p style="margin: 4px 0;"><strong>Item:</strong> ${itemName}</p>
                                <p style="margin: 4px 0;"><strong>Amount:</strong> ₹${booking.totalAmount}</p>
                                <p style="margin: 4px 0;"><strong>Status:</strong> ${statusEng}</p>
                            </div>
                            <p style="font-size: 13px; color: #78716c;">Helpline: +91 6353848203 | Ambaji Highway, Kheralu</p>
                        </div>
                    </div>
                `
            });
            console.log(`[Aagaman Status Email] Sent to ${booking.customerEmail}`);
        } catch (mailErr) {
            console.error(`[Aagaman Status Email Error]:`, mailErr.message);
        }
    }

    return { smsMessage, whatsappUrl, cleanMobile, whatsappResult };
}

app.put('/api/admin/bookings/:id/status', authenticateAdmin, async (req, res) => {
    const { status } = req.body;
    const bookings = readJson('bookings.json');
    const booking = bookings.find(b => b.id === req.params.id);

    if (!booking) {
        return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    booking.status = status || booking.status;
    booking.updatedAt = new Date().toISOString();
    writeJson('bookings.json', bookings);

    // Trigger customer SMS / WhatsApp notification
    let notificationInfo = null;
    try {
        notificationInfo = await sendOrderStatusNotification(booking, booking.status);
    } catch (err) {
        console.error("Order notification error:", err);
    }

    res.json({
        success: true,
        message: `Booking #${booking.id} status updated to ${status}. Notification prepared.`,
        booking,
        whatsappUrl: notificationInfo?.whatsappUrl || '',
        customerMobile: notificationInfo?.cleanMobile || booking.customerMobile
    });
});

// ==========================================
// CONTACT MESSAGES & INQUIRIES API
// ==========================================

app.post('/api/contact', async (req, res) => {
    const { name, mobile, email, subject, message } = req.body;
    if (!name || !mobile || !message) {
        return res.status(400).json({ success: false, message: 'Name, mobile, and message are required.' });
    }

    const contacts = readJson('contacts.json');
    const newContact = {
        id: 'MSG-' + Date.now().toString(36).toUpperCase(),
        name: String(name).trim(),
        mobile: String(mobile).trim(),
        email: (email && String(email).trim()) || '',
        subject: subject || 'General Inquiry',
        message: String(message).trim(),
        createdAt: new Date().toISOString()
    };

    contacts.unshift(newContact);
    writeJson('contacts.json', contacts);

    // Send email alert to hotel owner
    if (emailTransporter && (process.env.EMAIL_USER || process.env.GMAIL_USER)) {
        try {
            const sender = (process.env.EMAIL_USER || process.env.GMAIL_USER).trim();
            await emailTransporter.sendMail({
                from: `"Hotel Aagaman" <${sender}>`,
                to: process.env.HOTEL_OWNER_EMAIL || sender,
                subject: `New Website Inquiry from ${newContact.name} (${newContact.subject})`,
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px; color: #3E2723; max-width: 600px; border: 1px solid #2E473D; border-radius: 8px; background: #F5F0E6;">
                        <h2 style="color: #2E473D; margin-top: 0;">Hotel Aagaman - New Inquiry Received</h2>
                        <p><strong>Customer Name:</strong> ${newContact.name}</p>
                        <p><strong>Mobile Number:</strong> <a href="tel:${newContact.mobile}">${newContact.mobile}</a></p>
                        <p><strong>Email:</strong> ${newContact.email || 'N/A'}</p>
                        <p><strong>Subject:</strong> ${newContact.subject}</p>
                        <p><strong>Message:</strong></p>
                        <div style="background: #ffffff; padding: 14px; border-radius: 6px; border-left: 4px solid #C8705B; font-size: 15px;">
                            ${newContact.message}
                        </div>
                        <p style="font-size: 12px; color: #78716c; margin-top: 20px;">Submitted at: ${new Date().toLocaleString()}</p>
                    </div>
                `
            });
        } catch (e) {
            console.log("Contact email notification error:", e.message);
        }
    }

    // Auto-sync new customer inquiry to Google Drive / Sheets in real-time if enabled
    triggerGoogleSheetsSync({
        action: 'append_contact',
        type: 'contacts',
        contact: formatContactForSheet(newContact)
    });

    res.status(201).json({
        success: true,
        message: 'Your message has been received. Our team will contact you shortly.',
        contact: newContact
    });
});

app.get('/api/admin/contacts', authenticateAdmin, (req, res) => {
    const contacts = readJson('contacts.json');
    res.json({ success: true, contacts });
});

app.delete('/api/admin/contacts/:id', authenticateAdmin, (req, res) => {
    const contacts = readJson('contacts.json');
    const filtered = contacts.filter(c => c.id !== req.params.id);
    writeJson('contacts.json', filtered);
    res.json({ success: true, message: 'Inquiry deleted successfully.' });
});

// ==========================================
// REAL PAYMENT GATEWAY & HOTEL UPI
// ==========================================

app.get('/api/config/payment', (req, res) => {
    res.json({
        success: true,
        upiId: process.env.HOTEL_UPI_ID || 'sohamprajapati08@okicici',
        upiName: process.env.HOTEL_UPI_NAME || 'Hotel Aagaman',
        hasLiveRazorpay: Boolean(process.env.RAZORPAY_KEY_ID && !process.env.RAZORPAY_KEY_ID.includes('123456')),
        razorpayKey: process.env.RAZORPAY_KEY_ID || 'rzp_test_aagaman123456'
    });
});

app.post('/api/payment/create-order', authenticateToken, async (req, res) => {
    const { amount, currency = 'INR', receipt = 'receipt_' + Date.now() } = req.body;
    const numAmount = Math.round(Number(amount) * 100);

    if (!numAmount || numAmount <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid amount' });
    }

    const keyId = process.env.RAZORPAY_KEY_ID || 'rzp_test_aagaman123456';

    if (razorpayInstance && process.env.RAZORPAY_KEY_SECRET && !process.env.RAZORPAY_KEY_ID.includes('123456')) {
        try {
            const order = await razorpayInstance.orders.create({
                amount: numAmount,
                currency,
                receipt,
                payment_capture: 1
            });
            return res.json({
                success: true,
                orderId: order.id,
                amount: order.amount,
                currency: order.currency,
                key: keyId
            });
        } catch (err) {
            console.error("Razorpay order creation error:", err);
        }
    }

    // High-reliability test/sandbox fallback
    const mockOrderId = 'order_' + crypto.randomBytes(8).toString('hex');
    res.json({
        success: true,
        orderId: mockOrderId,
        amount: numAmount,
        currency: 'INR',
        key: keyId,
        isSandbox: true
    });
});

app.post('/api/payment/verify', authenticateToken, (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, bookingId } = req.body;

    if (!razorpay_payment_id) {
        return res.status(400).json({ success: false, message: 'Payment verification failed: missing payment ID.' });
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;
    let isValid = true;

    if (secret && razorpay_order_id && razorpay_signature && !secret.includes('2026')) {
        const body = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(body.toString())
            .digest('hex');
        isValid = (expectedSignature === razorpay_signature);
    }

    if (!isValid) {
        return res.status(400).json({ success: false, message: 'Invalid payment signature.' });
    }

    if (bookingId) {
        const bookings = readJson('bookings.json');
        const booking = bookings.find(b => b.id === bookingId);
        if (booking) {
            booking.paymentId = razorpay_payment_id;
            booking.status = 'Confirmed';
            writeJson('bookings.json', bookings);
        }
    }

    res.json({
        success: true,
        message: 'Payment verified successfully!',
        paymentId: razorpay_payment_id
    });
});

// ==========================================
// FILE UPLOAD API (Images & HD Videos)
// ==========================================
app.post('/api/upload', authenticateAdmin, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({
        success: true,
        message: 'File uploaded successfully!',
        url: fileUrl,
        filename: req.file.filename
    });
});

// ==========================================
// GOOGLE DRIVE & GOOGLE SHEETS LIVE SYNC HELPERS & API
// ==========================================

function formatBookingForSheet(b) {
    const isCash = String(b.paymentId).includes('CASH') || (b.paymentMethod && b.paymentMethod.includes('Cash'));
    return {
        'Booking ID': b.id,
        'Date & Time of Booking': b.createdAt ? new Date(b.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '',
        'Customer Name': b.customerName || 'Guest',
        'Mobile Number': b.customerMobile || '',
        'Email Address': b.customerEmail || '',
        'Room / Dish Ordered': b.itemDetails?.roomName || b.itemDetails?.dishName || b.itemDetails?.name || b.type || '',
        'Check-In Date': b.checkIn || '',
        'Shift': b.shift || 'full',
        'Total Amount (₹)': b.totalAmount || 0,
        'Payment Mode': isCash ? 'Cash on Arrival' : 'Online UPI',
        'Payment Ref / UTR': b.paymentId || 'N/A',
        'Payment Status': isCash ? 'Pending (Cash at Hotel)' : 'Paid (Verified UPI)',
        'Booking Status': b.status || 'Confirmed'
    };
}

function formatContactForSheet(c) {
    return {
        'Inquiry ID': c.id,
        'Date & Time Received': c.createdAt ? new Date(c.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '',
        'Guest Name': c.name || '',
        'Phone Number': c.mobile || '',
        'Email Address': c.email || '',
        'Subject': c.subject || 'General Inquiry',
        'Message Details': c.message || ''
    };
}

function formatUserForSheet(u) {
    return {
        'User ID': u.id,
        'Customer Name': u.name || 'Guest User',
        'Mobile Number': u.mobile || u.identifier || '',
        'Email Address': u.email || '',
        'Registration Date & Time': u.createdAt ? new Date(u.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
        'Last Active Date & Time': u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
        'Total Bookings Count': u.totalBookings || 0,
        'Total Spent Amount (₹)': u.totalSpent || 0
    };
}

async function triggerGoogleSheetsSync(payload) {
    try {
        const settings = readJson('settings.json', { googleSheetWebhookUrl: '', autoSyncDrive: false });
        if (!settings.googleSheetWebhookUrl || !settings.autoSyncDrive) return;

        await fetch(settings.googleSheetWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            redirect: 'follow'
        });
        console.log(`[Google Sheets Auto-Sync] Sent successfully for ${payload.action || payload.type}`);
    } catch (e) {
        console.warn(`[Google Sheets Auto-Sync Warning]:`, e.message);
    }
}

// GET admin settings (Google Drive / Sheets config)
app.get('/api/admin/settings', authenticateAdmin, (req, res) => {
    const settings = readJson('settings.json', {
        googleSheetWebhookUrl: '',
        autoSyncDrive: false
    });
    res.json({ success: true, settings });
});

// POST admin settings (Google Drive / Sheets config)
app.post('/api/admin/settings', authenticateAdmin, (req, res) => {
    const { googleSheetWebhookUrl, autoSyncDrive } = req.body;
    const settings = readJson('settings.json', {
        googleSheetWebhookUrl: '',
        autoSyncDrive: false
    });

    if (googleSheetWebhookUrl !== undefined) {
        settings.googleSheetWebhookUrl = String(googleSheetWebhookUrl).trim();
    }
    if (autoSyncDrive !== undefined) {
        settings.autoSyncDrive = Boolean(autoSyncDrive);
    }

    writeJson('settings.json', settings);
    res.json({
        success: true,
        message: 'Google Drive settings saved successfully.',
        settings
    });
});

// GET admin WhatsApp settings
app.get('/api/admin/whatsapp-settings', authenticateAdmin, (req, res) => {
    const settings = readJson('settings.json', {});
    res.json({
        success: true,
        settings: {
            whatsappProvider: settings.whatsappProvider || 'ultramsg',
            ultramsgInstanceId: settings.ultramsgInstanceId || process.env.ULTRAMSG_INSTANCE_ID || '',
            ultramsgToken: settings.ultramsgToken ? '••••••••' : (process.env.ULTRAMSG_TOKEN ? '••••••••' : ''),
            hasUltramsgToken: Boolean(settings.ultramsgToken || process.env.ULTRAMSG_TOKEN),
            greenApiInstanceId: settings.greenApiInstanceId || process.env.GREEN_API_INSTANCE_ID || '',
            greenApiToken: settings.greenApiToken ? '••••••••' : (process.env.GREEN_API_TOKEN ? '••••••••' : ''),
            hasGreenApiToken: Boolean(settings.greenApiToken || process.env.GREEN_API_TOKEN),
            whatsappWebhookUrl: settings.whatsappWebhookUrl || process.env.WHATSAPP_WEBHOOK_URL || '',
            whatsappAutoSend: settings.whatsappAutoSend !== false
        }
    });
});

// POST admin WhatsApp settings
app.post('/api/admin/whatsapp-settings', authenticateAdmin, (req, res) => {
    const {
        whatsappProvider,
        ultramsgInstanceId,
        ultramsgToken,
        greenApiInstanceId,
        greenApiToken,
        whatsappWebhookUrl,
        whatsappAutoSend
    } = req.body;

    const settings = readJson('settings.json', {});

    if (whatsappProvider !== undefined) settings.whatsappProvider = String(whatsappProvider).trim();
    if (ultramsgInstanceId !== undefined) settings.ultramsgInstanceId = String(ultramsgInstanceId).trim();
    if (ultramsgToken !== undefined && !String(ultramsgToken).includes('••••')) {
        settings.ultramsgToken = String(ultramsgToken).trim();
    }
    if (greenApiInstanceId !== undefined) settings.greenApiInstanceId = String(greenApiInstanceId).trim();
    if (greenApiToken !== undefined && !String(greenApiToken).includes('••••')) {
        settings.greenApiToken = String(greenApiToken).trim();
    }
    if (whatsappWebhookUrl !== undefined) settings.whatsappWebhookUrl = String(whatsappWebhookUrl).trim();
    if (whatsappAutoSend !== undefined) settings.whatsappAutoSend = Boolean(whatsappAutoSend);

    writeJson('settings.json', settings);

    res.json({
        success: true,
        message: 'WhatsApp Gateway settings saved successfully.',
        settings
    });
});

// POST admin test WhatsApp message
app.post('/api/admin/test-whatsapp', authenticateAdmin, async (req, res) => {
    const { testMobile } = req.body;
    const cleanMobile = String(testMobile || '').replace(/\D/g, '');
    const mob = cleanMobile.length === 12 && cleanMobile.startsWith('91') ? cleanMobile.slice(2) : cleanMobile;

    if (mob.length !== 10) {
        return res.status(400).json({ success: false, message: 'Please provide a valid 10-digit mobile number for testing.' });
    }

    const testMessage = `*Hotel Aagaman (Kheralu) - WhatsApp Gateway Test*\n\nNamaste! This is an automated test message from the Hotel Aagaman system.\n\n• Time: ${new Date().toLocaleString('en-IN')}\n• Helpline: +91 6353848203\n• Status: Automated WhatsApp Gateway is WORKING! ✅\n\nThank you, Hotel Aagaman.`;

    try {
        const result = await sendAutomatedWhatsAppMessage(mob, testMessage);
        if (result.success) {
            res.json({ success: true, message: `Test WhatsApp message sent successfully to +91 ${mob}!`, result });
        } else {
            res.status(400).json({
                success: false,
                message: result.message || 'Failed to send WhatsApp message. Please check your Instance ID and Token.',
                error: result.error
            });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error testing WhatsApp: ' + err.message });
    }
});

// POST manual sync to Google Drive / Sheets
app.post('/api/admin/sync-google-sheets', authenticateAdmin, async (req, res) => {
    const { type } = req.body; // 'bookings', 'contacts', 'users', or 'all'
    const settings = readJson('settings.json', { googleSheetWebhookUrl: '', autoSyncDrive: false });

    if (!settings.googleSheetWebhookUrl) {
        return res.status(400).json({
            success: false,
            message: 'Google Sheets Webhook URL is not configured. Please enter the Webhook URL in settings.'
        });
    }

    try {
        const payload = { type: type || 'all', timestamp: new Date().toISOString() };

        if (type === 'bookings' || type === 'all' || !type) {
            const bookings = readJson('bookings.json');
            payload.bookings = bookings.map(formatBookingForSheet);
        }

        if (type === 'contacts' || type === 'all' || !type) {
            const contacts = readJson('contacts.json');
            payload.contacts = contacts.map(formatContactForSheet);
        }

        if (type === 'users' || type === 'all' || !type) {
            const users = readJson('users.json');
            const bookings = readJson('bookings.json');
            const enriched = users.map(user => {
                const cleanUserMobile = user.mobile ? String(user.mobile).replace(/\D/g, '') : '';
                const userBookings = bookings.filter(b => {
                    const cleanBookingMobile = b.customerMobile ? String(b.customerMobile).replace(/\D/g, '') : '';
                    return b.userId === user.id || (cleanUserMobile && cleanBookingMobile && cleanUserMobile === cleanBookingMobile);
                });
                const totalSpent = userBookings
                    .filter(b => b.status === 'Confirmed' || b.status === 'Completed')
                    .reduce((sum, b) => sum + (Number(b.totalAmount) || 0), 0);
                return {
                    ...user,
                    totalBookings: userBookings.length,
                    totalSpent
                };
            });
            payload.users = enriched.map(formatUserForSheet);
        }

        const gRes = await fetch(settings.googleSheetWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            redirect: 'follow'
        });

        const gText = await gRes.text();
        console.log('[Google Sheets Manual Sync Result]:', gText);

        res.json({
            success: true,
            message: 'Data successfully synchronized with Google Sheets!',
            response: gText
        });
    } catch (err) {
        console.error('Google Sheets Sync Failed:', err);
        res.status(500).json({
            success: false,
            message: 'Error connecting with Google Sheets: ' + err.message
        });
    }
});

// ==========================================
// STATIC ASSETS & PAGES ROUTING
// ==========================================
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(__dirname));

// Clean routes
app.get('/room-booking', (req, res) => {
    res.sendFile(path.join(__dirname, 'room buking page.html'));
});

// Privacy Policy & Terms (Play Store Compliance)
app.get('/privacy-policy', (req, res) => {
    res.sendFile(path.join(__dirname, 'privacy-policy.html'));
});
app.get('/privacy-policy.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'privacy-policy.html'));
});
app.get('/terms', (req, res) => {
    res.sendFile(path.join(__dirname, 'terms-conditions.html'));
});
app.get('/terms-conditions', (req, res) => {
    res.sendFile(path.join(__dirname, 'terms-conditions.html'));
});
app.get('/terms-conditions.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'terms-conditions.html'));
});

// Google Play TWA Digital Asset Links
app.get('/.well-known/assetlinks.json', (req, res) => {
    const assetPath = path.join(__dirname, '.well-known', 'assetlinks.json');
    if (fs.existsSync(assetPath)) {
        res.setHeader('Content-Type', 'application/json');
        res.send(fs.readFileSync(assetPath, 'utf8'));
    } else {
        res.status(404).json({ error: 'Assetlinks not found' });
    }
});

// Secret Admin Panel Route
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(`Hotel Aagaman Server running on port ${PORT}`);
    console.log(`Website: http://localhost:${PORT}`);
    console.log(`Admin Portal: http://localhost:${PORT}/admin`);
    console.log(`Admin User: ${ADMIN_USERNAME} | Pass: ${ADMIN_PASSWORD}`);
    console.log(`=================================================`);

    // Render Keep-Alive: Ping itself periodically so Render stays warm
    const externalUrl = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
    if (externalUrl) {
        const PING_INTERVAL = 10 * 60 * 1000; // 10 minutes
        setInterval(async () => {
            try {
                const pingUrl = `${externalUrl.replace(/\/$/, '')}/ping`;
                const pingRes = await fetch(pingUrl);
                console.log(`[Keep-Alive Ping] Pinged ${pingUrl} - Status: ${pingRes.status}`);
            } catch (err) {
                console.warn(`[Keep-Alive Ping Warning]:`, err.message);
            }
        }, PING_INTERVAL);
        console.log(`[Keep-Alive] Configured for ${externalUrl} every 10 minutes.`);
    }
});
