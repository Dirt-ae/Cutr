import { Link } from "react-router-dom";
import { LogIn, LogOut, Settings, UploadCloud } from "lucide-react";

export default function MainNav({ user, logout, onOpenSettings }) {
  return (
    <div className="sticky top-0 z-50 px-3 pt-3">
      <nav className="mx-auto flex h-[58px] max-w-5xl items-center justify-between rounded-[28px] border border-white/[0.08] bg-[#0b0b0d]/95 px-4 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:px-5">
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

        <div className="flex items-center gap-2">
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
            className="inline-flex h-10 items-center rounded-full bg-white pl-1.5 pr-4 text-sm font-bold text-black shadow-[0_10px_30px_rgba(255,255,255,0.12)] transition-transform hover:scale-[1.02] active:scale-[0.98] gap-2"
          >
            {(() => {
              try {
                const du = JSON.parse(localStorage.getItem("discordUser") || "null");
                if (du && du.id) {
                  return (
                    <img
                      src={
                        du.avatar
                          ? `https://cdn.discordapp.com/avatars/${du.id}/${du.avatar}.png?size=64`
                          : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(du.id || 0) >> 22n) % 6}.png`
                      }
                      alt=""
                      className="w-7 h-7 rounded-full ring-2 ring-black/5"
                    />
                  );
                }
              } catch (e) {}
              return null;
            })()}
            Dashboard
          </Link>
        </div>
      </nav>
    </div>
  );
}
