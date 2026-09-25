import { useState } from 'react';
import { Link } from 'wouter';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { Logo } from './Logo';
import { AuthDialog } from './AuthDialog';
import { useAuth } from '@/context/AuthContext';

export function Header({ dark = false }: { dark?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const { user, isLoading, logout } = useAuth();
  return (
    <header className={`absolute inset-x-0 top-0 z-30 ${dark ? 'text-[#f5f0e6]' : 'text-[#203b47]'}`}>
      <div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-5 sm:px-8 sm:py-7">
        <Logo light={dark} />
        <nav className="hidden items-center gap-8 text-[13px] font-semibold md:flex">
          <a href="#how-it-works" className="opacity-80 transition hover:opacity-100" data-testid="link-how-it-works">
            How it works
          </a>
          <a href="#example-trip" className="opacity-80 transition hover:opacity-100" data-testid="link-example-trip">
            Example trip
          </a>
          {!isLoading && (
            user ? (
              <div className="flex items-center gap-4">
                <span className="max-w-[180px] truncate text-xs opacity-70">
                  {user.email}
                </span>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="opacity-80 transition hover:opacity-100"
                >
                  Log out
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAuthOpen(true)}
                className="opacity-80 transition hover:opacity-100"
              >
                Log in
              </button>
            )
          )}
          <Link
            href="/plan"
            className={`rounded-full px-5 py-2.5 transition ${
              dark ? 'bg-[#e8bc5a] text-[#203b47] hover:bg-[#f0cb77]' : 'bg-[#203b47] text-[#f5f0e6] hover:bg-[#315565]'
            }`}
            data-testid="link-start-planning"
          >
            Start planning <ArrowUpRight className="ml-1 inline-block" size={14} />
          </Link>
        </nav>
        <button
          className="md:hidden"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Open menu"
          data-testid="button-open-menu"
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>
      {menuOpen && (
        <div
          className={`mx-4 rounded-2xl p-4 shadow-lg md:hidden ${
            dark ? 'bg-[#203b47] text-[#f5f0e6]' : 'bg-[#fbfaf6] text-[#203b47]'
          }`}
        >
          <a
            href="#how-it-works"
            className="block border-b border-current/10 px-3 py-3 text-sm"
            onClick={() => setMenuOpen(false)}
          >
            How it works
          </a>
          <a
            href="#example-trip"
            className="block border-b border-current/10 px-3 py-3 text-sm"
            onClick={() => setMenuOpen(false)}
          >
            Example trip
          </a>
          {!isLoading && (
            user ? (
              <div className="border-b border-current/10 px-3 py-3">
                <p className="truncate text-xs opacity-70">{user.email}</p>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    void logout();
                  }}
                  className="mt-2 text-sm font-semibold"
                >
                  Log out
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setAuthOpen(true);
                }}
                className="block w-full border-b border-current/10 px-3 py-3 text-left text-sm"
              >
                Log in
              </button>
            )
          )}
          <Link
            href="/plan"
            className="block px-3 py-3 text-sm font-semibold"
            data-testid="link-mobile-start"
            onClick={() => setMenuOpen(false)}
          >
            Start planning <ArrowUpRight className="ml-1 inline" size={14} />
          </Link>
        </div>
      )}
      <AuthDialog open={authOpen} onOpenChange={setAuthOpen} />
    </header>
  );
}
