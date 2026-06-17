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

// Serve uploads static directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Multer Disk Storage setup
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
const upload = multer({ storage: storage });

// Metadata storage helper functions
const galleryFile = path.join(__dirname, 'gallery.json');
function getGalleryData() {
    if (!fs.existsSync(galleryFile)) {
        return [];
    }
    try {
        return JSON.parse(fs.readFileSync(galleryFile, 'utf8'));
    } catch (err) {
        return [];
    }
}
function saveGalleryData(data) {
    fs.writeFileSync(galleryFile, JSON.stringify(data, null, 2), 'utf8');
}

// Middleware
app.use(cors());
app.use(express.json());

// Email configuration
const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

// ============================================
// ROUTES
// ============================================

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'Server is running' });
});

// ============================================
// GALLERY ROUTES
// ============================================

// GET all gallery photos
app.get('/api/gallery', (req, res) => {
    const data = getGalleryData();
    res.json(data);
});

// POST upload a new photo
app.post('/api/gallery/upload', upload.single('photo'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const { title, category, description } = req.body;

        if (!title || !category) {
            return res.status(400).json({ message: 'Title and category are required' });
        }

        const newPhoto = {
            id: 'c_' + Date.now(),
            title: title.trim(),
            description: (description || '').trim(),
            category: category,
            image: `http://localhost:${process.env.PORT || 5000}/uploads/${req.file.filename}`,
            date: new Date().toISOString().split('T')[0]
        };

        const data = getGalleryData();
        data.unshift(newPhoto);
        saveGalleryData(data);

        res.json({ success: true, photo: newPhoto });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ message: 'Upload failed' });
    }
});

// DELETE a gallery photo by ID
app.delete('/api/gallery/:id', (req, res) => {
    try {
        const { id } = req.params;
        let data = getGalleryData();
        const photoIndex = data.findIndex(p => p.id === id);

        if (photoIndex === -1) {
            return res.status(404).json({ message: 'Photo not found' });
        }

        // Delete physical file if it exists locally
        const photo = data[photoIndex];
        if (photo.image && photo.image.includes('/uploads/')) {
            const filename = photo.image.split('/uploads/')[1];
            const filePath = path.join(__dirname, 'uploads', filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        data.splice(photoIndex, 1);
        saveGalleryData(data);

        res.json({ success: true, message: 'Photo deleted' });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ message: 'Delete failed' });
    }
});


app.post('/api/bookings', 
    body('name').notEmpty().trim(),
    body('email').isEmail(),
    body('phone').notEmpty().trim(),
    body('travelers').isInt({ min: 1 }),
    body('startDate').isISO8601(),
    async (req, res) => {
        try {
            // Validate input
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

            // Validate packages
            if (!packages || packages.length === 0) {
                return res.status(400).json({ message: 'No packages selected' });
            }

            // Generate itinerary HTML
            let itineraryHTML = '<h3>Selected Packages:</h3><ul>';
            packages.forEach((pkg, index) => {
                itineraryHTML += `<li><strong>${pkg.name}</strong> (${pkg.area}) - ${pkg.duration} days</li>`;
            });
            itineraryHTML += '</ul>';

            // Create email content for owner
            const ownerEmailContent = `
                <h2>New Travel Booking Request</h2>
                
                <h3>Customer Information:</h3>
                <p><strong>Name:</strong> ${name}</p>
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Phone:</strong> ${phone}</p>
                <p><strong>Number of Travelers:</strong> ${travelers}</p>
                <p><strong>Preferred Start Date:</strong> ${new Date(startDate).toLocaleDateString()}</p>
                
                <h3>Trip Summary:</h3>
                <p><strong>Total Days:</strong> ${totalDays}</p>
                <p><strong>Total Destinations:</strong> ${totalPlaces}</p>
                <p><strong>Total Experiences:</strong> ${totalExperiences}</p>
                
                <h3>Packages Selected:</h3>
                <table style="border-collapse: collapse; width: 100%;">
                    <tr style="background-color: #f0f0f0;">
                        <th style="border: 1px solid #ddd; padding: 10px; text-align: left;">Package</th>
                        <th style="border: 1px solid #ddd; padding: 10px; text-align: left;">Area</th>
                        <th style="border: 1px solid #ddd; padding: 10px; text-align: left;">Duration</th>
                        <th style="border: 1px solid #ddd; padding: 10px; text-align: left;">Places</th>
                        <th style="border: 1px solid #ddd; padding: 10px; text-align: left;">Experiences</th>
                    </tr>
                    ${packages.map(pkg => `
                        <tr>
                            <td style="border: 1px solid #ddd; padding: 10px;">${pkg.name}</td>
                            <td style="border: 1px solid #ddd; padding: 10px;">${pkg.area}</td>
                            <td style="border: 1px solid #ddd; padding: 10px;">${pkg.duration} days</td>
                            <td style="border: 1px solid #ddd; padding: 10px;">${pkg.places.join(', ')}</td>
                            <td style="border: 1px solid #ddd; padding: 10px;">${pkg.experiences.join(', ')}</td>
                        </tr>
                    `).join('')}
                </table>
                
                ${specialRequests ? `<h3>Special Requests:</h3><p>${specialRequests}</p>` : ''}
                
                <hr>
                <p><strong>Submitted on:</strong> ${new Date().toLocaleString()}</p>
            `;

            // Email to owner
            const ownerMailOptions = {
                from: process.env.EMAIL_USER,
                to: process.env.OWNER_EMAIL || 'owner@ceyloncanary.com',
                subject: `New Booking Request from ${name}`,
                html: ownerEmailContent
            };

            // Confirmation email to customer
            const customerEmailContent = `
                <h2>Thank You for Your Booking Request!</h2>
                
                <p>Dear ${name},</p>
                
                <p>We have received your multi-day travel package request. Our team will review your preferences and contact you shortly with personalized recommendations and pricing.</p>
                
                <h3>Your Trip Details:</h3>
                <ul>
                    <li><strong>Total Days:</strong> ${totalDays}</li>
                    <li><strong>Start Date:</strong> ${new Date(startDate).toLocaleDateString()}</li>
                    <li><strong>Number of Travelers:</strong> ${travelers}</li>
                </ul>
                
                <h3>Your Selected Packages:</h3>
                <ul>
                    ${packages.map(pkg => `<li>${pkg.name} (${pkg.area})</li>`).join('')}
                </ul>
                
                <p><strong>Contact Information:</strong></p>
                <p>Email: ${process.env.CONTACT_EMAIL}</p>
                <p>Phone: ${process.env.CONTACT_PHONE}</p>
                
                <p>We look forward to creating an unforgettable experience for you in Sri Lanka!</p>
                
                <p>Best regards,<br>Ceylon Canary Team</p>
            `;

            const customerMailOptions = {
                from: process.env.EMAIL_USER,
                to: email,
                subject: 'Your Ceylon Canary Booking Request Received!',
                html: customerEmailContent
            };

            // Send emails
            await transporter.sendMail(ownerMailOptions);
            await transporter.sendMail(customerMailOptions);

            res.json({
                success: true,
                message: 'Booking request received. Emails sent successfully.'
            });

        } catch (error) {
            console.error('Error processing booking:', error);
            res.status(500).json({
                success: false,
                message: 'Error processing booking request'
            });
        }
    }
);

// Contact form submission
app.post('/api/contact',
    body('name').notEmpty().trim(),
    body('email').isEmail(),
    body('message').notEmpty().trim(),
    async (req, res) => {
        try {
            // Validate input
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const { name, email, message } = req.body;

            // Email to owner
            const ownerMailOptions = {
                from: process.env.EMAIL_USER,
                to: process.env.OWNER_EMAIL || 'owner@ceyloncanary.com',
                subject: `New Contact Form Message from ${name}`,
                html: `
                    <h2>New Message from Website Contact Form</h2>
                    <p><strong>Name:</strong> ${name}</p>
                    <p><strong>Email:</strong> ${email}</p>
                    <h3>Message:</h3>
                    <p>${message}</p>
                    <p><strong>Submitted on:</strong> ${new Date().toLocaleString()}</p>
                `
            };

            // Confirmation to sender
            const senderMailOptions = {
                from: process.env.EMAIL_USER,
                to: email,
                subject: 'We received your message - Ceylon Canary',
                html: `
                    <h2>Thank You for Contacting Us!</h2>
                    <p>Dear ${name},</p>
                    <p>We have received your message and will get back to you as soon as possible.</p>
                    <p>Best regards,<br>Ceylon Canary Team</p>
                `
            };

            await transporter.sendMail(ownerMailOptions);
            await transporter.sendMail(senderMailOptions);

            res.json({
                success: true,
                message: 'Message sent successfully'
            });

        } catch (error) {
            console.error('Error sending contact message:', error);
            res.status(500).json({
                success: false,
                message: 'Error sending message'
            });
        }
    }
);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: 'Something went wrong!'
    });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Make sure to set up your .env file with email credentials');
});
