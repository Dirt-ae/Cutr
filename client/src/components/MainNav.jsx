import { Link, useLocation } from "react-router-dom";
import { useState } from "react";
import { LogIn, LogOut, Menu, Settings, UploadCloud, X } from "lucide-react";

const NAV_LINKS = [
  { to: "/info", label: "Help Center" },
  { to: "/resources", label: "Resources" },
  { href: "https://discord.gg/JAbzJX4Jce", label: "Discord" },
  { to: "/forms", label: "Forms" },
  { to: "/admin", label: "Admin", adminOnly: true },
  { href: "https://ko-fi.com/cutrr", label: "Donations" },
];

function NavLink({ item, user, className = "" }) {
  if (item.adminOnly && !user?.isAdmin) return null;

  const sharedClassName = className || "transition-colors hover:text-white/80";

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
        className="absolute inset-0 bg-black/45 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close menu"
      />
      <aside className="absolute right-0 top-0 flex h-dvh w-[min(86vw,22rem)] flex-col border-l border-white/10 bg-[#090b10]/95 p-4 shadow-[-24px_0_70px_rgba(0,0,0,0.55)]">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-xl font-black tracking-tight text-white">CUTRR</span>
          <button
            type="button"
            onClick={onClose}
            className="grid h-11 w-11 place-items-center rounded-full bg-white/[0.08] text-white transition-colors hover:bg-white/[0.14]"
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
                  ? "bg-white text-black"
                  : "text-white/75 hover:bg-white/10 hover:text-white"
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
            className="touch-link justify-start rounded-2xl px-4 text-sm font-semibold text-white/75 hover:bg-white/10 hover:text-white min-[420px]:hidden"
          >
            {user ? "Logout" : "Login"}
          </Link>
        </nav>
      </aside>
    </div>
  );
}

export default function MainNav({ user, logout, onOpenSettings, variant = "top" }) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  let discordUser = null;
  try {
    discordUser = JSON.parse(localStorage.getItem("discordUser") || "null");
  } catch (e) {}

  const hasDiscordAvatar = Boolean(discordUser?.id);

  if (variant === "sidebar") {
    return (
      <>
        <div className="fixed left-3 top-3 z-[700] hidden w-[240px] lg:block">
          <aside className="forms-nav-sidebar flex max-h-[calc(100vh-1.5rem)] w-full flex-col overflow-auto rounded-[28px] border p-3 backdrop-blur-xl">
            <Link
              to="/"
              className="flex items-center justify-between rounded-2xl border px-3 py-2.5 text-white transition-opacity hover:opacity-80"
            >
              <span className="text-xl font-black tracking-tight">CUTRR</span>
              <Avatar discordUser={discordUser} />
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

            <div className="mt-4 border-t border-white/[0.08] pt-4">
              <div className="flex items-center gap-2">
                <Link
                  to={user ? "/" : "/login"}
                  onClick={(event) => {
                    if (user && logout) {
                      event.preventDefault();
                      logout();
                    }
                  }}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-blue-950/25 text-white/60 transition-colors hover:bg-blue-400/10 hover:text-white"
                  title={user ? "Logout" : "Login"}
                >
                  {user ? <LogOut size={16} /> : <LogIn size={16} />}
                </Link>
                <Link
                  to="/"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-blue-950/25 text-white/60 transition-colors hover:bg-blue-400/10 hover:text-white"
                  title="Upload"
                >
                  <UploadCloud size={16} />
                </Link>
                {onOpenSettings && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-blue-950/25 text-white/60 transition-colors hover:bg-blue-400/10 hover:text-white"
                    title="Theme settings"
                  >
                    <Settings size={16} />
                  </button>
                )}
              </div>

              <Link
                to="/dashboard"
                className={`mt-3 inline-flex h-11 w-full items-center justify-start rounded-2xl border border-white/10 bg-white/95 px-3 text-sm font-bold text-slate-950 shadow-[0_10px_30px_rgba(89,130,255,0.18)] transition-transform hover:scale-[1.01] active:scale-[0.98] ${
                  hasDiscordAvatar ? "gap-2" : ""
                }`}
              >
                <Avatar discordUser={discordUser} />
                <span>Dashboard</span>
              </Link>
            </div>
          </aside>
        </div>

        <div className="sticky top-0 z-[700] px-3 pt-3 lg:hidden">
          <nav className="site-nav mx-auto flex min-h-[60px] max-w-5xl items-center justify-between gap-2 rounded-[28px] border border-white/[0.08] bg-white/[0.045] px-3 py-2 shadow-none backdrop-blur-xl sm:h-[60px] sm:gap-3 sm:px-5 sm:py-0">
            <Link
              to="/"
              className="flex min-w-0 items-center text-white transition-opacity hover:opacity-80"
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
                className="hidden h-11 w-11 place-items-center rounded-full bg-white/[0.06] text-white/70 transition-colors hover:bg-white/[0.1] hover:text-white min-[420px]:grid"
                title={user ? "Logout" : "Login"}
              >
                {user ? <LogOut size={16} /> : <LogIn size={16} />}
              </Link>
              <Link
                to="/"
                className="hidden h-11 w-11 place-items-center rounded-full bg-white/[0.06] text-white/70 transition-colors hover:bg-white/[0.1] hover:text-white sm:grid"
                title="Upload"
              >
                <UploadCloud size={16} />
              </Link>
              {onOpenSettings && (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="grid h-11 w-11 place-items-center rounded-full bg-white/[0.06] text-white/70 transition-colors hover:bg-white/[0.1] hover:text-white"
                  title="Theme settings"
                >
                  <Settings size={16} />
                </button>
              )}
              <Link
                to="/dashboard"
                className={`inline-flex h-11 items-center rounded-full bg-white text-xs font-bold text-black shadow-[0_10px_30px_rgba(255,255,255,0.12)] transition-transform hover:scale-[1.02] active:scale-[0.98] sm:text-sm ${
                  hasDiscordAvatar ? "gap-2 pl-1.5 pr-4" : "px-4"
                }`}
              >
                <Avatar discordUser={discordUser} />
                Dashboard
              </Link>
              <button
                type="button"
                onClick={() => setMenuOpen((current) => !current)}
                className="grid h-11 w-11 place-items-center rounded-full bg-white/[0.08] text-white transition-colors hover:bg-white/[0.14]"
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
    <div className="sticky top-0 z-[700] px-3 pt-3">
      <nav className="site-nav mx-auto flex min-h-[60px] max-w-5xl items-center justify-between gap-2 rounded-[28px] border border-white/[0.08] bg-white/[0.045] px-3 py-2 shadow-none backdrop-blur-xl sm:h-[60px] sm:gap-3 sm:px-5 sm:py-0 md:bg-[#0b0b0d]/45 md:shadow-[0_18px_60px_rgba(0,0,0,0.26)]">
        <Link
          to="/"
          className="flex min-w-0 items-center text-white transition-opacity hover:opacity-80"
        >
          <span className="text-xl font-black tracking-tight">CUTRR</span>
        </Link>

        <div className="hidden items-center gap-8 text-sm font-medium text-white/45 md:flex">
          {NAV_LINKS.map((item) => (
            <NavLink key={item.label} item={item} user={user} />
          ))}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <Link
            to={user ? "/" : "/login"}
            onClick={(event) => {
              if (user && logout) {
                event.preventDefault();
                logout();
              }
            }}
            className="hidden h-11 w-11 place-items-center rounded-full bg-white/[0.06] text-white/70 transition-colors hover:bg-white/[0.1] hover:text-white min-[420px]:grid"
            title={user ? "Logout" : "Login"}
          >
            {user ? <LogOut size={16} /> : <LogIn size={16} />}
          </Link>
          <Link
            to="/"
            className="hidden h-11 w-11 place-items-center rounded-full bg-white/[0.06] text-white/70 transition-colors hover:bg-white/[0.1] hover:text-white sm:grid"
            title="Upload"
          >
            <UploadCloud size={16} />
          </Link>
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="grid h-11 w-11 place-items-center rounded-full bg-white/[0.06] text-white/70 transition-colors hover:bg-white/[0.1] hover:text-white"
              title="Theme settings"
            >
              <Settings size={16} />
            </button>
          )}
          <Link
            to="/dashboard"
            className={`inline-flex h-11 items-center rounded-full bg-white text-xs font-bold text-black shadow-[0_10px_30px_rgba(255,255,255,0.12)] transition-transform hover:scale-[1.02] active:scale-[0.98] sm:text-sm ${
              hasDiscordAvatar ? "gap-2 pl-1.5 pr-4" : "px-4"
            }`}
          >
            {hasDiscordAvatar && (
              <img
                src={
                  discordUser.avatar
                    ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=64`
                    : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(discordUser.id || 0) >> 22n) % 6}.png`
                }
                alt=""
                className="w-7 h-7 rounded-full ring-2 ring-black/5"
              />
            )}
            Dashboard
          </Link>
          <button
            type="button"
            onClick={() => setMenuOpen((current) => !current)}
            className="grid h-11 w-11 place-items-center rounded-full bg-white/[0.08] text-white transition-colors hover:bg-white/[0.14] md:hidden"
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
  );
}
