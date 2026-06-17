const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

dotenv.config();

const app = express();

/* =========================================
   ENV CONFIG
========================================= */
const PORT = process.env.PORT || 5000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

/* =========================================
   MIDDLEWARE
========================================= */

// CORS (frontend connection)
app.use(cors());

app.use(express.json());

// Serve uploads folder
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

/* =========================================
   MULTER SETUP
========================================= */

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage });

/* =========================================
   GALLERY STORAGE (JSON FILE)
========================================= */

const galleryFile = path.join(__dirname, 'gallery.json');

function getGalleryData() {
    if (!fs.existsSync(galleryFile)) return [];
    try {
        return JSON.parse(fs.readFileSync(galleryFile, 'utf8'));
    } catch {
        return [];
    }
}

function saveGalleryData(data) {
    fs.writeFileSync(galleryFile, JSON.stringify(data, null, 2));
}

/* =========================================
   EMAIL TRANSPORTER
========================================= */

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

/* =========================================
   ROUTES
========================================= */

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'Server is running' });
});

/* =========================================
   GALLERY ROUTES
========================================= */

// GET gallery
app.get('/api/gallery', (req, res) => {
    res.json(getGalleryData());
});

// UPLOAD image
app.post('/api/gallery/upload', upload.single('photo'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const { title, category, description } = req.body;

        if (!title || !category) {
            return res.status(400).json({ message: 'Title and category required' });
        }

        const newPhoto = {
            id: 'c_' + Date.now(),
            title: title.trim(),
            description: (description || '').trim(),
            category,
            image: `${BASE_URL}/uploads/${req.file.filename}`,
            date: new Date().toISOString().split('T')[0]
        };

        const data = getGalleryData();
        data.unshift(newPhoto);
        saveGalleryData(data);

        res.json({ success: true, photo: newPhoto });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Upload failed' });
    }
});

// DELETE image
app.delete('/api/gallery/:id', (req, res) => {
    try {
        const { id } = req.params;
        let data = getGalleryData();

        const index = data.findIndex(p => p.id === id);
        if (index === -1) {
            return res.status(404).json({ message: 'Photo not found' });
        }

        const photo = data[index];

        // delete file
        if (photo.image) {
            const filename = photo.image.split('/uploads/')[1];
            const filePath = path.join(__dirname, 'uploads', filename);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }

        data.splice(index, 1);
        saveGalleryData(data);

        res.json({ success: true, message: 'Deleted' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Delete failed' });
    }
});

/* =========================================
   BOOKING ROUTE
========================================= */

app.post('/api/bookings',
    body('name').notEmpty(),
    body('email').isEmail(),
    body('phone').notEmpty(),
    body('travelers').isInt({ min: 1 }),
    body('startDate').isISO8601(),
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const {
                name,
                email,
                phone,
                travelers,
                startDate,
                specialRequests,
                packages,
                totalDays,
                totalExperiences,
                totalPlaces
            } = req.body;

            if (!packages?.length) {
                return res.status(400).json({ message: 'No packages selected' });
            }

            // Extract package names
            const packageNames = Array.isArray(packages) 
                ? packages.map(p => typeof p === 'string' ? p : p.name).join(', ')
                : packages;

            console.log('Processing booking for:', name, 'with packages:', packageNames);

            // Send email to owner
            const ownerMailOptions = {
                from: process.env.EMAIL_USER,
                to: process.env.EMAIL_USER,
                subject: `New Booking from ${name}`,
                html: `
                    <h2>New Booking Received</h2>
                    <p><strong>Name:</strong> ${name}</p>
                    <p><strong>Email:</strong> ${email}</p>
                    <p><strong>Phone:</strong> ${phone}</p>
                    <p><strong>Number of Travelers:</strong> ${travelers}</p>
                    <p><strong>Start Date:</strong> ${startDate}</p>
                    <p><strong>Packages:</strong> ${packageNames}</p>
                    <p><strong>Special Requests:</strong> ${specialRequests || 'None'}</p>
                    <hr>
                    <p>Please respond to the customer as soon as possible.</p>
                `
            };

            // Send confirmation email to customer
            const customerMailOptions = {
                from: process.env.EMAIL_USER,
                to: email,
                subject: 'Booking Received - Ceylon Canary Tours',
                html: `
                    <h2>Thank You, ${name}!</h2>
                    <p>We have received your booking request with the following details:</p>
                    <p><strong>Number of Travelers:</strong> ${travelers}</p>
                    <p><strong>Start Date:</strong> ${startDate}</p>
                    <p><strong>Packages:</strong> ${packageNames}</p>
                    <hr>
                    <p>We will review your request and contact you shortly to confirm your booking.</p>
                    <p>Best regards,<br/>Ceylon Canary Tours Team</p>
                `
            };

            try {
                const ownerResult = await transporter.sendMail(ownerMailOptions);
                console.log('Owner email sent:', ownerResult.messageId);
                
                const customerResult = await transporter.sendMail(customerMailOptions);
                console.log('Customer email sent:', customerResult.messageId);
            } catch (emailErr) {
                console.error('Email sending failed:', emailErr.message);
                return res.status(500).json({ message: 'Failed to send booking confirmation emails' });
            }

            res.json({ success: true });

        } catch (err) {
            console.error(err);
            res.status(500).json({ message: 'Booking failed' });
        }
    }
);

/* =========================================
   CONTACT ROUTE
========================================= */

app.post('/api/contact',
    body('name').notEmpty(),
    body('email').isEmail(),
    body('message').notEmpty(),
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const { name, email, message } = req.body;

            console.log('Processing contact form from:', name);

            // Send email to owner
            const ownerMailOptions = {
                from: process.env.EMAIL_USER,
                to: process.env.EMAIL_USER,
                subject: `New Contact Message from ${name}`,
                html: `
                    <h2>New Contact Form Submission</h2>
                    <p><strong>Name:</strong> ${name}</p>
                    <p><strong>Email:</strong> ${email}</p>
                    <hr>
                    <h3>Message:</h3>
                    <p>${message.replace(/\n/g, '<br>')}</p>
                `
            };

            // Send confirmation email to customer
            const customerMailOptions = {
                from: process.env.EMAIL_USER,
                to: email,
                subject: 'We Received Your Message - Ceylon Canary Tours',
                html: `
                    <h2>Thank You, ${name}!</h2>
                    <p>We have received your message and will get back to you as soon as possible.</p>
                    <hr>
                    <p>Best regards,<br/>Ceylon Canary Tours Team</p>
                `
            };

            try {
                const ownerResult = await transporter.sendMail(ownerMailOptions);
                console.log('Owner contact email sent:', ownerResult.messageId);
                
                const customerResult = await transporter.sendMail(customerMailOptions);
                console.log('Customer contact confirmation email sent:', customerResult.messageId);
            } catch (emailErr) {
                console.error('Contact email sending failed:', emailErr.message);
                return res.status(500).json({ message: 'Failed to send confirmation emails' });
            }

            res.json({ success: true });

        } catch (err) {
            console.error(err);
            res.status(500).json({ message: 'Message failed' });
        }
    }
);

/* =========================================
   START SERVER
========================================= */

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});