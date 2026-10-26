"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

const ADMIN_UID = "3d33a011-a26f-4f39-9c0f-317916b46add";
const BUCKET = "books-pdf";

const categories = [
  "Software Engineering",
  "Database Systems",
  "Networking",
  "Programming",
  "Operating Systems",
  "Cybersecurity",
  "Other",
];

type Book = {
  id: number;
  title: string;
  author: string;
  category: string;
  description: string | null;
  file_path: string;
  created_at: string;
};

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [bookCategory, setBookCategory] = useState(categories[0]);
  const [file, setFile] = useState<File | null>(null);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showLogin, setShowLogin] = useState(false);
  const [showRegister, setShowRegister] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const isAdmin = user?.id === ADMIN_UID;

  const loadBooks = useCallback(async () => {
    setLoading(true);

    try {
      const { data, error: booksError } = await supabase
        .from("books")
        .select(
          "id, title, author, category, description, file_path, created_at"
        )
        .order("created_at", { ascending: false });

      if (booksError) {
        throw booksError;
      }

      setBooks((data ?? []) as Book[]);
    } catch (err) {
      console.error("Loading books failed:", err);
      setError(
        "Could not load books: " +
          (err instanceof Error ? err.message : String(err))
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function initializeAuth() {
      const { data, error: sessionError } =
        await supabase.auth.getSession();

      if (!active) return;

      if (sessionError) {
        setError("Login status error: " + sessionError.message);
      }

      setUser(data.session?.user ?? null);
      setAuthReady(true);
    }

    void initializeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    void loadBooks();
  }, [loadBooks]);

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);

    try {
      if (showRegister) {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });

        if (authError) throw authError;

        if (data.session) {
          setUser(data.user);
          setShowRegister(false);
          setMessage("Account created successfully!");
        } else {
          setMessage(
            "Account created. Check your email to confirm your account before logging in."
          );
        }
      } else {
        const { data, error: authError } =
          await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });

        if (authError) throw authError;

        setUser(data.user);
        setShowLogin(false);
        setPassword("");
        setMessage("You are logged in successfully.");
      }
    } catch (err) {
      setError(
        "Authentication failed: " +
          (err instanceof Error ? err.message : String(err))
      );
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setError("");
    setMessage("");

    const { error: signOutError } = await supabase.auth.signOut();

    if (signOutError) {
      setError("Sign out failed: " + signOutError.message);
      return;
    }

    setUser(null);
    setMessage("You have signed out.");
  }

  async function uploadBook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setMessage("");

    if (!user || user.id !== ADMIN_UID) {
      setError("Only the configured administrator can upload books.");
      return;
    }

    if (!file) {
      setError("Please select a PDF file.");
      return;
    }

    if (
      file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")
    ) {
      setError("Please select a PDF file.");
      return;
    }

    if (!title.trim() || !author.trim()) {
      setError("Enter the book title and author.");
      return;
    }

    // Capture the form before awaiting network requests.
    const form = event.currentTarget;

    setBusy(true);

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = `${user.id}/${Date.now()}-${safeName}`;

    let uploadedPath: string | null = null;

    try {
      // Step 1: Upload the PDF into Supabase Storage.
      const { data: uploadData, error: uploadError } =
        await supabase.storage.from(BUCKET).upload(filePath, file, {
          contentType: "application/pdf",
          upsert: false,
        });

      if (uploadError) {
        throw new Error(
          "PDF Storage upload failed: " + uploadError.message
        );
      }

      uploadedPath = uploadData.path;

      // Step 2: Save the book details in the database.
      const { error: databaseError } = await supabase
        .from("books")
        .insert({
          title: title.trim(),
          author: author.trim(),
          category: bookCategory,
          description: description.trim() || null,
          file_path: uploadedPath,
        });

      if (databaseError) {
        throw new Error(
          "Database insert failed: " + databaseError.message
        );
      }

      setTitle("");
      setAuthor("");
      setDescription("");
      setBookCategory(categories[0]);
      setFile(null);
      form.reset();

      setMessage("Book uploaded successfully!");

      await loadBooks();
    } catch (err) {
      const detail =
        err instanceof Error ? err.message : String(err);

      console.error("Book upload failed:", detail);

      // If the PDF was uploaded but its database record failed,
      // try to remove the unregistered PDF.
      if (uploadedPath) {
        const { error: cleanupError } = await supabase.storage
          .from(BUCKET)
          .remove([uploadedPath]);

        if (cleanupError) {
          console.error("PDF cleanup failed:", cleanupError.message);
        }
      }

      setError(detail);
    } finally {
      setBusy(false);
    }
  }

  async function openBook(book: Book) {
    setError("");
    setMessage("");

    const { data, error: signedUrlError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(book.file_path, 300);

    if (signedUrlError) {
      setError("Could not open PDF: " + signedUrlError.message);
      return;
    }

    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  const filteredBooks = books.filter((book) => {
    const term = search.toLowerCase();

    const matchesSearch =
      book.title.toLowerCase().includes(term) ||
      book.author.toLowerCase().includes(term) ||
      book.category.toLowerCase().includes(term);

    const matchesCategory =
      category === "All" || book.category === category;

    return matchesSearch && matchesCategory;
  });

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <a href="#" className="text-xl font-extrabold text-blue-800">
            📚 Woyesa Digital Library
          </a>

          <div className="flex flex-wrap items-center gap-2">
            {user ? (
              <>
                <span className="max-w-48 truncate text-sm text-slate-600">
                  {user.email}
                </span>

                {isAdmin && (
                  <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-800">
                    ADMIN
                  </span>
                )}

                <button
                  type="button"
                  onClick={signOut}
                  className="rounded-xl bg-slate-100 px-4 py-2 font-semibold"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setShowLogin(true);
                    setShowRegister(false);
                    setError("");
                    setMessage("");
                  }}
                  className="rounded-xl px-4 py-2 font-semibold hover:bg-slate-100"
                >
                  Login
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowRegister(true);
                    setShowLogin(false);
                    setError("");
                    setMessage("");
                  }}
                  className="rounded-xl bg-blue-700 px-4 py-2 font-semibold text-white"
                >
                  Register
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="bg-gradient-to-br from-blue-950 to-indigo-800 px-5 py-20 text-white">
        <div className="mx-auto max-w-5xl text-center">
          <p className="mb-4 font-semibold text-blue-200">
            YOUR DIGITAL LEARNING DESTINATION
          </p>

          <h1 className="text-4xl font-extrabold sm:text-6xl">
            Discover Knowledge.
            <span className="mt-2 block text-blue-300">
              Learn Without Limits.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl leading-8 text-blue-100">
            Find educational books, lecture notes, programming materials
            and PDF resources in one place.
          </p>

          <a
            href="#library"
            className="mt-8 inline-block rounded-xl bg-white px-6 py-3 font-bold text-blue-900"
          >
            Explore Library ↓
          </a>
        </div>
      </section>

      {message && (
        <div
          role="status"
          className="mx-auto mt-5 max-w-5xl rounded-xl bg-green-50 p-4 text-green-800"
        >
          {message}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mx-auto mt-5 max-w-5xl break-words rounded-xl bg-red-50 p-4 text-red-700"
        >
          {error}
        </div>
      )}

      {isAdmin && (
        <section className="mx-auto max-w-5xl px-5 py-10">
          <div className="rounded-2xl border border-blue-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-extrabold">
              📤 Admin: Upload a PDF
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              This form is available to the configured administrator.
            </p>

            <form
              onSubmit={uploadBook}
              className="mt-6 grid gap-4 sm:grid-cols-2"
            >
              <div>
                <label className="mb-2 block text-sm font-semibold">
                  Book title
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  className="w-full rounded-xl border p-3"
                  placeholder="Introduction to Database Systems"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold">
                  Author
                </label>
                <input
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  required
                  className="w-full rounded-xl border p-3"
                  placeholder="Author name"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold">
                  Category
                </label>
                <select
                  value={bookCategory}
                  onChange={(e) => setBookCategory(e.target.value)}
                  className="w-full rounded-xl border bg-white p-3"
                >
                  {categories.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold">
                  PDF file
                </label>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  required
                  onChange={(e) =>
                    setFile(e.target.files?.[0] ?? null)
                  }
                  className="w-full rounded-xl border p-3"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="mb-2 block text-sm font-semibold">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-xl border p-3"
                  rows={3}
                  placeholder="Brief description of this book"
                />
              </div>

              <button
                type="submit"
                disabled={busy}
                className="rounded-xl bg-blue-700 px-5 py-3 font-bold text-white disabled:opacity-50 sm:col-span-2"
              >
                {busy ? "Please wait..." : "Upload Book"}
              </button>
            </form>
          </div>
        </section>
      )}

      <section id="library" className="mx-auto max-w-7xl px-5 py-14">
        <div className="mb-8">
          <h2 className="text-3xl font-extrabold">
            📚 Explore the Library
          </h2>
          <p className="mt-2 text-slate-500">
            Search books and select a category.
          </p>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title, author or category..."
          className="mb-5 w-full rounded-xl border bg-white p-4"
        />

        <div className="mb-8 flex flex-wrap gap-2">
          {["All", ...categories].map((item) => (
            <button
              type="button"
              key={item}
              onClick={() => setCategory(item)}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                category === item
                  ? "bg-blue-700 text-white"
                  : "bg-white text-slate-700 hover:bg-blue-50"
              }`}
            >
              {item}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="py-10 text-center">Loading books...</p>
        ) : filteredBooks.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-white p-10 text-center">
            <p className="text-xl font-bold">No books found yet.</p>
            <p className="mt-2 text-slate-500">
              Books uploaded by the administrator will appear here.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filteredBooks.map((book) => (
              <article
                key={book.id}
                className="rounded-2xl border bg-white p-6 shadow-sm transition hover:shadow-lg"
              >
                <div className="text-4xl">📘</div>

                <span className="mt-4 inline-block rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                  {book.category}
                </span>

                <h3 className="mt-4 text-xl font-extrabold">
                  {book.title}
                </h3>

                <p className="mt-2 text-sm text-slate-600">
                  Author: {book.author}
                </p>

                {book.description && (
                  <p className="mt-3 text-sm leading-6 text-slate-500">
                    {book.description}
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => openBook(book)}
                  className="mt-5 w-full rounded-xl bg-blue-700 px-4 py-3 font-bold text-white hover:bg-blue-800"
                >
                  📖 Read / Download PDF
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer className="bg-slate-950 px-5 py-8 text-center text-sm text-slate-400">
        <p className="font-bold text-white">Woyesa Digital Library</p>
        <p className="mt-2">Discover Knowledge. Learn Without Limits.</p>
        <p className="mt-4">© 2026 Woyesa Digital Library</p>
      </footer>

      {(showLogin || showRegister) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            setShowLogin(false);
            setShowRegister(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl bg-white p-7"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl font-extrabold">
              {showLogin ? "Welcome Back!" : "Create Account"}
            </h2>

            {showRegister && (
              <p className="mt-2 text-sm text-slate-500">
                Register to join the library.
              </p>
            )}

            <form onSubmit={handleAuth} className="mt-6 space-y-4">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                autoComplete="email"
                required
                className="w-full rounded-xl border p-3"
              />

              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (at least 8 characters)"
                autoComplete={
                  showLogin ? "current-password" : "new-password"
                }
                minLength={8}
                required
                className="w-full rounded-xl border p-3"
              />

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-xl bg-blue-700 p-3 font-bold text-white disabled:opacity-50"
              >
                {busy
                  ? "Please wait..."
                  : showLogin
                    ? "Login"
                    : "Create Account"}
              </button>
            </form>

            <button
              type="button"
              onClick={() => {
                setShowLogin(!showLogin);
                setShowRegister(!showRegister);
                setError("");
                setMessage("");
              }}
              className="mt-5 w-full text-sm font-semibold text-blue-700"
            >
              {showLogin
                ? "Need an account? Register"
                : "Already registered? Login"}
            </button>

            <button
              type="button"
              onClick={() => {
                setShowLogin(false);
                setShowRegister(false);
              }}
              className="mt-3 w-full rounded-xl bg-slate-100 p-3"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
