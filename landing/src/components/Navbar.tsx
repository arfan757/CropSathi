import { useEffect, useState } from 'react';
import { Sprout, Menu, X } from 'lucide-react';

const navLinks = [
  { label: 'The Problem', href: '#problem' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Features', href: '#features' },
  { label: 'Impact', href: '#impact' },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-[#fbf9f8]/95 backdrop-blur-lg shadow-md shadow-black/5'
          : 'bg-transparent'
      }`}
    >
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        {/* Logo */}
        <a href="#" className="flex items-center gap-2.5">
          <div className="icon-3d-green flex h-10 w-10 items-center justify-center rounded-xl">
            <Sprout className="h-5 w-5 text-white" strokeWidth={2.5} />
          </div>
          <span className={`text-xl font-bold tracking-tight font-display ${
            scrolled ? 'text-[#1b1c1c]' : 'text-white'
          }`}>
            Crop<span className={scrolled ? 'text-[#006038]' : 'text-[#80d9a2]'}>Sathi</span>
          </span>
        </a>

        {/* Desktop nav */}
        <div className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`text-sm font-semibold transition-colors ${
                scrolled
                  ? 'text-[#3f4941] hover:text-[#006038]'
                  : 'text-white/85 hover:text-white'
              }`}
            >
              {link.label}
            </a>
          ))}
          <a
            href="/login.html"
            className={`text-sm font-semibold transition-colors ${
              scrolled
                ? 'text-[#3f4941] hover:text-[#006038]'
                : 'text-white/85 hover:text-white'
            }`}
          >
            Log In
          </a>
          <a
            href="/login.html#register"
            className={`rounded-full px-6 py-2.5 text-sm font-bold transition-all ${
              scrolled
                ? 'btn-3d text-white'
                : 'btn-3d-white'
            }`}
          >
            Get Started
          </a>
        </div>

        {/* Mobile toggle */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className={`md:hidden ${scrolled ? 'text-[#1b1c1c]' : 'text-white'}`}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="border-t border-black/5 bg-[#fbf9f8]/95 backdrop-blur-lg md:hidden">
          <div className="flex flex-col gap-4 px-6 py-6">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="text-sm font-semibold text-[#3f4941] transition-colors hover:text-[#006038]"
              >
                {link.label}
              </a>
            ))}
            <a
              href="/login.html"
              onClick={() => setMobileOpen(false)}
              className="text-sm font-semibold text-[#3f4941] transition-colors hover:text-[#006038]"
            >
              Log In
            </a>
            <a
              href="/login.html#register"
              onClick={() => setMobileOpen(false)}
              className="btn-3d rounded-full px-6 py-3 text-center text-sm font-bold text-white"
            >
              Get Started
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
