import { Link } from "react-router-dom";
import { LogIn, LogOut, Settings, UploadCloud } from "lucide-react";

export default function MainNav({ user, logout, onOpenSettings }) {
  let discordUser = null;
  try {
    discordUser = JSON.parse(localStorage.getItem("discordUser") || "null");
  } catch (e) {}

  const hasDiscordAvatar = Boolean(discordUser?.id);

  return (
    <div className="sticky top-0 z-50 px-3 pt-3">
      <nav className="mx-auto flex min-h-[58px] max-w-5xl items-center justify-between gap-3 rounded-[28px] border border-white/[0.08] bg-[#0b0b0d]/95 px-3 py-2 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:h-[58px] sm:px-5 sm:py-0">
        <Link
          to="/"
          className="flex min-w-0 items-center text-white transition-opacity hover:opacity-80"
        >
          <span className="text-xl font-black tracking-tight">CUTR</span>
        </Link>

        <div className="hidden items-center gap-8 text-sm font-medium text-white/45 md:flex">
          <Link to="/info" className="transition-colors hover:text-white/80">
            Help Center
          </Link>
          <a
            href="https://discord.gg/JAbzJX4Jce"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-white/80"
          >
            Discord
          </a>
          <Link to="/forms" className="transition-colors hover:text-white/80">
            Forms
          </Link>
          {user?.isAdmin && (
            <Link to="/admin" className="transition-colors hover:text-white/80">
              Admin
            </Link>
          )}
          <a
            href="https://ko-fi.com/cutrr"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-white/80"
          >
            Donations
          </a>
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
            className="grid h-9 w-9 place-items-center rounded-full bg-black/30 text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white"
            title={user ? "Logout" : "Login"}
          >
            {user ? <LogOut size={16} /> : <LogIn size={16} />}
          </Link>
          <Link
            to="/"
            className="hidden h-9 w-9 place-items-center rounded-full bg-black/30 text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white sm:grid"
            title="Upload"
          >
            <UploadCloud size={16} />
          </Link>
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="grid h-9 w-9 place-items-center rounded-full bg-black/30 text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white"
              title="Theme settings"
            >
              <Settings size={16} />
            </button>
          )}
          <Link
            to="/dashboard"
            className={`inline-flex h-10 items-center rounded-full bg-white text-xs font-bold text-black shadow-[0_10px_30px_rgba(255,255,255,0.12)] transition-transform hover:scale-[1.02] active:scale-[0.98] sm:text-sm ${
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
        </div>
      </nav>

      <div className="mx-auto mt-2 flex max-w-5xl gap-2 overflow-x-auto pb-1 md:hidden">
        <Link
          to="/info"
          className="shrink-0 rounded-full border border-white/[0.08] bg-[#0b0b0d]/90 px-3 py-2 text-xs font-medium text-white/60 backdrop-blur-xl"
        >
          Help Center
        </Link>
        <Link
          to="/forms"
          className="shrink-0 rounded-full border border-white/[0.08] bg-[#0b0b0d]/90 px-3 py-2 text-xs font-medium text-white/60 backdrop-blur-xl"
        >
          Forms
        </Link>
        {user?.isAdmin && (
          <Link
            to="/admin"
            className="shrink-0 rounded-full border border-white/[0.08] bg-[#0b0b0d]/90 px-3 py-2 text-xs font-medium text-white/60 backdrop-blur-xl"
          >
            Admin
          </Link>
        )}
        <a
          href="https://discord.gg/JAbzJX4Jce"
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-full border border-white/[0.08] bg-[#0b0b0d]/90 px-3 py-2 text-xs font-medium text-white/60 backdrop-blur-xl"
        >
          Discord
        </a>
        <a
          href="https://ko-fi.com/cutrr"
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-full border border-white/[0.08] bg-[#0b0b0d]/90 px-3 py-2 text-xs font-medium text-white/60 backdrop-blur-xl"
        >
          Donations
        </a>
      </div>
    </div>
  );
}
