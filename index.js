const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const path = require("path");
const session = require('express-session');
const cors = require('cors');
// const router = express.Router();


const app = express();
const port = 3000;


app.use(
    session({
        secret: 'omhassen12',
        resave: false,
        saveUninitialized: false,
        cookie: { maxAge: 60 * 60 * 1000 }, // 1 hour
    })
);
app.use(express.static(__dirname));
app.use(
    cors({
        origin: 'http://localhost:3000', // Replace with your frontend URL
        credentials: true, // Allow cookies
    })
);
app.use(express.json());
// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// MySQL Connection
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'omhassen12', // Your MySQL root password
    database: 'user_auth'
});

db.connect(err => {
    if (err) {
        console.error('Database connection failed:', err.stack);
        return;
    }
    console.log('Connected to MySQL database.');
});



// Login Endpoint
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    const query = 'SELECT * FROM users WHERE email = ?';
    db.query(query, [email], async (err, results) => {
        if (err) throw err;

        if (results.length > 0) {
            const user = results[0];

            // Compare hashed password
            const isMatch = await bcrypt.compare(password, user.password);
            if (isMatch) {
                req.session.user_id = user.user_id; // Store user_id in session
                res.json({ success: true, message: 'Login successful!' });
            } else {
                res.json({ success: false, message: 'Invalid password.' });
            }
        } else {
            res.json({ success: false, message: 'User not found.' });
        }
    });
});





// Sign-Up Endpoint
app.post('/signup', async (req, res) => {
    const { email, password } = req.body;

    const checkQuery = 'SELECT * FROM users WHERE email = ?';
    db.query(checkQuery, [email], async (err, results) => {
        if (err) throw err;

        if (results.length > 0) {
            res.json({ success: false, message: 'Email is already registered.' });
        } else {
            // Hash the password
            const hashedPassword = await bcrypt.hash(password, 10);
            const insertQuery = 'INSERT INTO users (email, password) VALUES (?, ?)';
            db.query(insertQuery, [email, hashedPassword], (err, results) => {
                if (err) {
                    res.json({ success: false, message: 'Error inserting data.' });
                } else {
                    res.json({ success: true, message: 'Sign-up successful!' });
                }
            });
        }
    });
});




app.get('/stations', (req, res) => {
    const query = `
        SELECT DISTINCT fromStation AS station FROM reservations
        UNION
        SELECT DISTINCT toStation AS station FROM reservations
    `;
    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching stations:', err);
            return res.status(500).json({ success: false, message: 'Failed to fetch stations.' });
        }

        const stations = results.map(row => row.station);
        res.json({ success: true, stations });
    });
});

// Fetch reservations with optional filters
app.get('/reservations', (req, res) => {
    const { fromStation, toStation } = req.query;
    let query = `
        SELECT train_id, fromStation, toStation, 
               TIME_FORMAT(departureTime, "%H:%i") AS departureTime 
        FROM reservations`;
    const params = [];

    if (fromStation || toStation) {
        query += ' WHERE ';
        if (fromStation) {
            query += 'fromStation = ?';
            params.push(fromStation);
        }
        if (toStation) {
            query += fromStation ? ' AND ' : '';
            query += 'toStation = ?';
            params.push(toStation);
        }
    }

    db.query(query, params, (err, results) => {
        if (err) {
            console.error('Error fetching reservations:', err);
            return res.status(500).json({ success: false, message: 'Failed to fetch reservations.' });
        }

        res.json({ success: true, reservations: results });
    });
});


// Endpoint to handle reservations

// Reserve tickets
app.post('/reserve', (req, res) => {
    const user_id = req.session.user_id; // Retrieve user_id from the session

    if (!user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized. Please log in.' });
    }

    const { reservations } = req.body;

    if (!reservations || reservations.length === 0) {
        return res.status(400).json({ success: false, message: 'No reservations selected for reservation.' });
    }

    const values = reservations.map(reservation => [
        reservation.train_id,
        reservation.fromStation,
        reservation.toStation,
        reservation.departureTime,
        user_id,  // Associate the reservation with the logged-in user
    ]);

    const query = `
        INSERT INTO tickets (train_id, fromStation, toStation, departureTime, user_id)
        VALUES ?`;

    db.query(query, [values], (err, results) => {
        if (err) {
            console.error('Error reserving tickets:', err);
            return res.status(500).json({ success: false, message: 'Failed to reserve tickets.' });
        }

        res.json({ success: true, message: 'Tickets reserved successfully!' });
    });
});

// Endpoint to create tickets from selected reservations
app.post('/create-tickets', (req, res) => {
    const user_id = req.session.user_id; // Fetch user_id from session

    if (!user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized. Please log in.' });
    }

    const { tickets } = req.body;

    if (!Array.isArray(tickets) || tickets.length === 0) {
        return res.status(400).json({ success: false, message: 'No tickets data received.' });
    }

    const values = tickets.map(ticket => [
        ticket.train_id,
        ticket.fromStation,
        ticket.toStation,
        ticket.departureTime,
        user_id,
    ]);

    const query = `
        INSERT INTO tickets (train_id, fromStation, toStation, departureTime, user_id)
        VALUES ?`;

    db.query(query, [values], (err, results) => {
        if (err) {
            console.error('Error inserting tickets:', err);
            return res.status(500).json({ success: false, message: 'Failed to create tickets.' });
        }

        res.json({ success: true, message: 'Tickets created successfully!' });
    });
});


// Fetch all tickets for the current user
app.get('/tickets', (req, res) => {
    const user_id = req.session.user_id;

    console.log("User ID from session:", user_id);

    if (!user_id) {
        console.error("No user ID in session.");
        return res.status(401).json({ success: false, message: 'Unauthorized. Please log in.' });
    }

    const query = `
        SELECT ticket_id, train_id, fromStation, toStation, TIME_FORMAT(departureTime, '%H:%i') AS departureTime
        FROM tickets
        WHERE user_id = ?
    `;

    db.query(query, [user_id], (err, results) => {
        if (err) {
            console.error('Error fetching tickets:', err);
            return res.status(500).json({ success: false, message: 'Failed to fetch tickets.' });
        }

        if (results.length === 0) {
            console.log('No tickets found for user:', user_id);
        } else {
            console.log('Tickets fetched:', results);
        }

        res.json({ success: true, tickets: results });
    });
});



// Cancel selected tickets
app.post('/cancel-tickets', (req, res) => {
    const user_id = req.session.user_id; // Fetch user_id from session

    if (!user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized. Please log in.' });
    }

    const { ticket_ids } = req.body;

    if (!ticket_ids || ticket_ids.length === 0) {
        return res.status(400).json({ success: false, message: 'No tickets selected for cancellation.' });
    }

    const query = `
        DELETE FROM tickets 
        WHERE ticket_id IN (?) AND user_id = ?`;

    db.query(query, [ticket_ids, user_id], (err, results) => {
        if (err) {
            console.error('Error canceling tickets:', err);
            return res.status(500).json({ success: false, message: 'Failed to cancel tickets.' });
        }

        res.json({ success: true, message: 'Tickets canceled successfully!' });
    });
});



// Start the server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});




