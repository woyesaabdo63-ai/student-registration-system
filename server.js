require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const path = require("path");
const session = require("express-session");
const bcrypt = require("bcrypt");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: false, // Development localhost qofaaf
            sameSite: "lax",
            maxAge: 1000 * 60 * 60
        }
    })
);

// Database connection
const db = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "student_registration_db",
    port: Number(process.env.DB_PORT) || 3306,
    waitForConnections: true,
    connectionLimit: 10
});

// Home page
app.get("/", (req, res) => {
    if (req.session.adminId) {
        return res.sendFile(path.join(__dirname, "index.html"));
    }

    res.redirect("/login.html");
});

// Login page
app.get("/login.html", (req, res) => {
    res.sendFile(path.join(__dirname, "login.html"));
});

// Check database
app.get("/test-db", async (req, res) => {
    try {
        const [rows] = await db.query("SELECT 1 AS result");
        res.json({
            success: true,
            message: "Database connection successful!",
            data: rows
        });
    } catch (error) {
        console.error("Database error:", error.message);
        res.status(500).json({
            success: false,
            message: "Database connection failed"
        });
    }
});

// Login API
app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message: "Username fi password galchi."
        });
    }

    try {
        const [admins] = await db.execute(
            "SELECT id, username, password_hash FROM admins WHERE username = ?",
            [username]
        );

        if (admins.length === 0) {
            return res.status(401).json({
                success: false,
                message: "Username ykn password sirrii miti."
            });
        }

        const admin = admins[0];
        const passwordMatches = await bcrypt.compare(
            password,
            admin.password_hash
        );

        if (!passwordMatches) {
            return res.status(401).json({
                success: false,
                message: "Username ykn password sirrii miti."
            });
        }

        req.session.regenerate((error) => {
            if (error) {
                console.error("Session error:", error.message);
                return res.status(500).json({
                    success: false,
                    message: "Login gochuun hin danda'amne."
                });
            }

            req.session.adminId = admin.id;
            req.session.adminUsername = admin.username;

            res.json({
                success: true,
                message: "Login milkaa'e!",
                redirect: "/"
            });
        });
    } catch (error) {
        console.error("Login error:", error.message);
        res.status(500).json({
            success: false,
            message: "Dogoggorri server uumame."
        });
    }
});

// Check whether admin is logged in
app.get("/api/me", (req, res) => {
    if (!req.session.adminId) {
        return res.status(401).json({
            loggedIn: false
        });
    }

    res.json({
        loggedIn: true,
        username: req.session.adminUsername
    });
});

// Logout
app.post("/api/logout", (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            return res.status(500).json({
                success: false,
                message: "Logout gochuun hin danda'amne."
            });
        }

        res.clearCookie("connect.sid");
        res.json({
            success: true,
            message: "Logout milkaa'e!"
        });
    });
});

// Protect student-management API routes
function requireAdmin(req, res, next) {
    if (!req.session.adminId) {
        return res.status(401).json({
            success: false,
            message: "Itti fufuuf duraan login godhi."
        });
    }

    next();
}

// Get all students
app.get("/students", requireAdmin, async (req, res) => {
    try {
        const [students] = await db.query(
            "SELECT * FROM students ORDER BY id DESC"
        );
        res.json(students);
    } catch (error) {
        console.error("Students error:", error.message);
        res.status(500).json({
            success: false,
            message: "Barattoota argachuun hin danda'amne."
        });
    }
});

// Add student
// Register a new student
app.post("/students", requireAdmin, async (req, res) => {
    const {
        studentId,
        firstName,
        lastName,
        gender,
        email,
        department
    } = req.body;

    if (
        !studentId ||
        !firstName ||
        !lastName ||
        !gender ||
        !email ||
        !department
    ) {
        return res.status(400).json({
            success: false,
            message: "Odeeffannoo barataa hunda guuti."
        });
    }

    try {
        const [result] = await db.execute(
            `INSERT INTO students
            (student_id, first_name, last_name, gender, email, department)
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                studentId,
                firstName,
                lastName,
                gender,
                email,
                department
            ]
        );

        res.status(201).json({
            success: true,
            message: "Barataan milkaa'inaan galmaa'e.",
            id: result.insertId
        });
    } catch (error) {
        console.error("Add student error:", error.message);

        res.status(500).json({
            success: false,
            message: "Barataa galmeessuun hin danda'amne. Database table kee ilaali."
        });
    }
});

// Update student
app.put("/students/:id", requireAdmin, async (req, res) => {
    const {
        studentId,
        firstName,
        lastName,
        gender,
        email,
        department
    } = req.body;

    const id = Number(req.params.id);

    if (
        !Number.isInteger(id) ||
        id < 1 ||
        !studentId ||
        !firstName ||
        !lastName ||
        !gender ||
        !email ||
        !department
    ) {
        return res.status(400).json({
            success: false,
            message: "Odeeffannoo barataa hunda sirriitti guuti."
        });
    }

    try {
        const [result] = await db.execute(
            `UPDATE students
            SET student_id = ?,
                first_name = ?,
                last_name = ?,
                gender = ?,
                email = ?,
                department = ?
            WHERE id = ?`,
            [
                studentId,
                firstName,
                lastName,
                gender,
                email,
                department,
                id
            ]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Barataan hin argamne."
            });
        }

        res.json({
            success: true,
            message: "Odeeffannoon barataa haaromfame."
        });
    } catch (error) {
        console.error("Update student error:", error.message);

        res.status(500).json({
            success: false,
            message: "Odeeffannoo barataa haaromsuun hin danda'amne."
        });
    }
});

// Delete student
app.delete("/students/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({
            success: false,
            message: "ID sirrii miti."
        });
    }

    try {
        const [result] = await db.execute(
            "DELETE FROM students WHERE id = ?",
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Barataan hin argamne."
            });
        }

        res.json({
            success: true,
            message: "Barataan haqame."
        });
    } catch (error) {
        console.error("Delete error:", error.message);
        res.status(500).json({
            success: false,
            message: "Barataa haquun hin danda'amne."
        });
    }
});

// API status
app.get("/api-status", (req, res) => {
    res.json({
        message: "Student Registration System Backend is Running!"
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});