import { Link, useLocation } from "react-router-dom";
import { useState } from "react";
import { LogIn, LogOut, Menu, Moon, Sun, X } from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";

const NAV_LINKS = [
  { to: "/resources", label: "Resources" },
  { href: "https://discord.gg/JAbzJX4Jce", label: "Discord" },
  { to: "/forms", label: "Forms" },
  { to: "/admin", label: "Admin", adminOnly: true },
  { href: "https://ko-fi.com/cutrr", label: "Donations" },
];

function NavLink({ item, user, className = "" }) {
  if (item.adminOnly && !user?.isAdmin) return null;

  const sharedClassName = className || "theme-link transition-colors";

  if (item.to) {
    return (
      <Link to={item.to} className={sharedClassName}>
        {item.label}
      </Link>
    );
  }

  return (
    <a
      href={item.href}
      target="_blank"
      rel="noopener noreferrer"
      className={sharedClassName}
    >
      {item.label}
    </a>
  );
}

function Avatar({ discordUser }) {
  if (!discordUser?.id) return null;

  return (
    <img
      src={
        discordUser.avatar
          ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=64`
          : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(discordUser.id || 0) >> 22n) % 6}.png`
      }
      alt=""
      className="h-7 w-7 rounded-full ring-2 ring-black/5"
    />
  );
}

function MobileMenuDrawer({ open, onClose, user, logout, location }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] md:hidden">
      <button
        type="button"
        className="absolute inset-0 backdrop-blur-sm"
        style={{ background: "var(--modal-backdrop)" }}
        onClick={onClose}
        aria-label="Close menu"
      />
      <aside className="absolute right-0 top-0 flex h-dvh w-[min(86vw,22rem)] flex-col border-l border-[var(--panel-border)] bg-[var(--panel-bg)] p-4 shadow-[-24px_0_70px_rgba(0,0,0,0.24)]">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-xl font-black tracking-tight text-[var(--page-fg)]">CUTRR</span>
          <button
            type="button"
            onClick={onClose}
            className="grid h-11 w-11 place-items-center rounded-full bg-[var(--muted-bg)] text-[var(--page-fg)] transition-colors hover:bg-[var(--muted-bg-strong)]"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>
        <nav className="grid gap-1">
          {NAV_LINKS.map((item) => (
            <NavLink
              key={item.label}
              item={item}
              user={user}
              className={`touch-link justify-start rounded-2xl px-4 text-sm font-semibold ${
                item.to && location.pathname === item.to
                  ? "bg-[var(--primary-button-bg)] text-[var(--primary-button-fg)]"
                  : "text-[var(--muted-text-strong)] hover:bg-[var(--muted-bg)] hover:text-[var(--page-fg)]"
              }`}
            />
          ))}
          <Link
            to={user ? "/" : "/login"}
            onClick={(event) => {
              onClose();
              if (user && logout) {
                event.preventDefault();
                logout();
              }
            }}
            className="touch-link justify-start rounded-2xl px-4 text-sm font-semibold text-[var(--muted-text-strong)] hover:bg-[var(--muted-bg)] hover:text-[var(--page-fg)] min-[420px]:hidden"
          >
            {user ? "Logout" : "Login"}
          </Link>
        </nav>
      </aside>
    </div>
  );
}

export default function MainNav({ user, logout, variant = "top" }) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { colorMode, toggleColorMode } = useTheme();
  let discordUser = null;
  try {
    discordUser = JSON.parse(localStorage.getItem("discordUser") || "null");
  } catch (e) {}

  const navDiscordUser = user ? discordUser : null;
  const hasDiscordAvatar = Boolean(navDiscordUser?.id);

  if (variant === "sidebar") {
    return (
      <>
        <div className="fixed left-3 top-3 z-[700] hidden w-[240px] lg:block">
          <aside className="forms-nav-sidebar flex max-h-[calc(100vh-1.5rem)] w-full flex-col overflow-auto rounded-[28px] border p-3 backdrop-blur-xl">
            <Link
              to="/"
              className="flex items-center justify-between rounded-2xl border px-3 py-2.5 text-[var(--page-fg)] transition-opacity hover:opacity-80"
            >
              <span className="text-xl font-black tracking-tight">CUTRR</span>
              <Avatar discordUser={navDiscordUser} />
            </Link>

            <div className="mt-4 space-y-1">
              {NAV_LINKS.map((item) => (
                <NavLink
                  key={item.label}
                  item={item}
                  user={user}
                  className={`forms-nav-link flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                    (item.to && location.pathname === item.to) ||
                    (item.to === "/dashboard" && location.pathname === "/dashboard")
                      ? "is-active"
                      : ""
                  }`}
                />
              ))}
            </div>

            <div className="mt-4 border-t border-[var(--panel-border)] pt-4">
              <div className="flex items-center gap-2">
                <Link
                  to={user ? "/" : "/login"}
                  onClick={(event) => {
                    if (user && logout) {
                      event.preventDefault();
                      logout();
                    }
                  }}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[var(--muted-border)] bg-[var(--muted-bg)] text-[var(--muted-text)] transition-colors hover:bg-[var(--muted-bg-strong)] hover:text-[var(--page-fg)]"
                  title={user ? "Logout" : "Login"}
                >
                  {user ? <LogOut size={16} /> : <LogIn size={16} />}
                </Link>
                <button
                  type="button"
                  onClick={toggleColorMode}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[var(--muted-border)] bg-[var(--muted-bg)] text-[var(--muted-text)] transition-colors hover:bg-[var(--muted-bg-strong)] hover:text-[var(--page-fg)]"
                  title={colorMode === "light" ? "Switch to dark mode" : "Switch to light mode"}
                >
                  {colorMode === "light" ? <Moon size={16} /> : <Sun size={16} />}
                </button>
              </div>

              <Link
                to="/"
                className={`mt-3 inline-flex h-11 w-full items-center justify-start rounded-2xl border border-transparent bg-[var(--primary-button-bg)] px-3 text-sm font-bold text-[var(--primary-button-fg)] shadow-[0_10px_30px_rgba(89,130,255,0.18)] transition-transform hover:scale-[1.01] active:scale-[0.98] ${
                  hasDiscordAvatar ? "gap-2" : ""
                }`}
              >
                <Avatar discordUser={navDiscordUser} />
                <span>Dashboard</span>
              </Link>
            </div>
          </aside>
        </div>

        <div className="sticky top-0 z-[700] px-3 pt-3 lg:hidden">
          <nav className="site-nav mx-auto flex min-h-[60px] max-w-7xl items-center justify-between gap-2 rounded-lg border border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 py-2 shadow-none backdrop-blur-xl sm:h-[60px] sm:gap-3 sm:px-5 sm:py-0">
            <Link
              to="/"
              className="flex min-w-0 items-center text-[var(--page-fg)] transition-opacity hover:opacity-80"
            >
              <span className="text-xl font-black tracking-tight">CUTRR</span>
            </Link>

            <div className="flex items-center gap-1.5 sm:gap-2">
              <Link
                to={user ? "/" : "/login"}
                onClick={(event) => {
                  if (user && logout) {
                    event.preventDefault();
                    logout();
                  }
                }}
                className="hidden h-11 w-11 place-items-center rounded-lg bg-[var(--muted-bg)] text-[var(--muted-text)] transition-colors hover:bg-[var(--muted-bg-strong)] hover:text-[var(--page-fg)] min-[420px]:grid"
                title={user ? "Logout" : "Login"}
              >
                {user ? <LogOut size={16} /> : <LogIn size={16} />}
              </Link>
              <button
                type="button"
                onClick={toggleColorMode}
                className="grid h-11 w-11 place-items-center rounded-lg bg-[var(--muted-bg)] text-[var(--muted-text)] transition-colors hover:bg-[var(--muted-bg-strong)] hover:text-[var(--page-fg)]"
                title={colorMode === "light" ? "Switch to dark mode" : "Switch to light mode"}
              >
                {colorMode === "light" ? <Moon size={16} /> : <Sun size={16} />}
              </button>
              <Link
                to="/"
                className={`inline-flex h-11 items-center rounded-lg bg-[var(--primary-button-bg)] text-xs font-bold text-[var(--primary-button-fg)] shadow-[0_10px_30px_rgba(37,99,235,0.18)] transition-transform hover:scale-[1.02] active:scale-[0.98] sm:text-sm ${
                  hasDiscordAvatar ? "gap-2 pl-1.5 pr-4" : "px-4"
                }`}
              >
                <Avatar discordUser={navDiscordUser} />
                Dashboard
              </Link>
              <button
                type="button"
                onClick={() => setMenuOpen((current) => !current)}
                className="grid h-11 w-11 place-items-center rounded-lg bg-[var(--muted-bg)] text-[var(--page-fg)] transition-colors hover:bg-[var(--muted-bg-strong)]"
                aria-label={menuOpen ? "Close menu" : "Open menu"}
                aria-expanded={menuOpen}
              >
                {menuOpen ? <X size={18} /> : <Menu size={18} />}
              </button>
            </div>
          </nav>

          <MobileMenuDrawer
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            user={user}
            logout={logout}
            location={location}
          />
        </div>
      </>
    );
  }

  return (
    <div className="sticky top-0 z-[700]">
      {!user && (
        <div className="border-b border-[var(--panel-border)] bg-black px-3 py-2 text-center text-xs font-semibold text-white sm:px-5 md:px-8">
          You are using CUTRR as a guest. Videos expire after 14 days.{" "}
          <Link to="/login" className="underline underline-offset-2 hover:opacity-85">
            Sign up for free
          </Link>{" "}
          to host your videos for longer.
        </div>
      )}
      <nav className="site-nav mx-auto flex h-12 w-full items-center justify-between border-b border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 sm:px-5 md:px-8">
        <Link
          to="/"
          className="flex min-w-0 items-center text-[var(--page-fg)] transition-opacity hover:opacity-80"
        >
          <span className="text-base font-semibold tracking-tight">CUTRR</span>
        </Link>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <Link
            to={user ? "/" : "/login"}
            onClick={(event) => {
              if (user && logout) {
                event.preventDefault();
                logout();
              }
            }}
            className="hidden h-8 items-center rounded px-2 text-xs font-medium text-[var(--muted-text)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--page-fg)] min-[420px]:inline-flex"
            title={user ? "Logout" : "Login"}
          >
            {user ? "Log out" : "Log in"}
          </Link>
          <button
            type="button"
            onClick={toggleColorMode}
            className="grid h-11 w-11 place-items-center rounded text-[var(--muted-text)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--page-fg)] md:h-8 md:w-8"
            title={colorMode === "light" ? "Switch to dark mode" : "Switch to light mode"}
          >
            {colorMode === "light" ? <Moon size={14} /> : <Sun size={14} />}
          </button>
          <Link
            to="/"
            className={`inline-flex min-h-11 items-center rounded bg-[#1d7df2] text-xs font-semibold text-white transition-colors hover:bg-[#1869cc] md:h-8 ${
              hasDiscordAvatar ? "gap-1.5 pl-1.5 pr-3" : "px-3"
            }`}
          >
            {hasDiscordAvatar && (
              <img
                src={
                  navDiscordUser.avatar
                    ? `https://cdn.discordapp.com/avatars/${navDiscordUser.id}/${navDiscordUser.avatar}.png?size=64`
                    : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(navDiscordUser.id || 0) >> 22n) % 6}.png`
                }
                alt=""
                className="h-5 w-5 rounded-full ring-1 ring-black/10"
              />
            )}
            Dashboard
          </Link>
          <button
            type="button"
            onClick={() => setMenuOpen((current) => !current)}
            className="grid h-11 w-11 place-items-center rounded text-[var(--muted-text)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--page-fg)] md:hidden"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </nav>

      <MobileMenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        user={user}
        logout={logout}
        location={location}
      />

    </div>
  );
}
