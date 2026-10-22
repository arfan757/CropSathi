import { ArrowRight, Satellite, ScanLine, Leaf } from 'lucide-react';

const heroImg =
  'https://images.pexels.com/photos/20269181/pexels-photo-20269181.jpeg?auto=compress&cs=tinysrgb&h=650&w=940';

const floatingBadges = [
  { icon: Satellite, label: 'Satellite NDVI' },
  { icon: ScanLine, label: 'CNN Disease Scan' },
  { icon: Leaf, label: '38 Plant Classes' },
];

export default function Hero() {
  return (
    <section className="relative min-h-screen overflow-hidden">
      {/* Background image */}
      <div className="absolute inset-0">
        <img
          src={heroImg}
          alt="Aerial view of farmer in vibrant green rice fields"
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-[#004025]/95 via-[#006038]/85 to-[#1a7a4c]/75" />
        <div className="absolute inset-0 grid-overlay opacity-30" />
      </div>

      {/* Content */}
      <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl flex-col justify-center px-6 pt-24 pb-16">
        <div className="max-w-3xl">
          {/* Badge */}
          <div className="reveal mb-6 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-1.5 backdrop-blur-sm">
            <span className="flex h-2 w-2 rounded-full bg-[#ffb599] animate-pulse-slow" />
            <span className="text-sm font-medium text-white/90">
              Satellite + AI · Early Disease Detection
            </span>
          </div>

          {/* Headline */}
          <h1 className="reveal text-5xl font-extrabold leading-[1.1] text-white sm:text-6xl lg:text-7xl tracking-tight font-display">
            Catch crop disease
            <br />
            <span className="text-[#ffb599]">days before</span> the damage shows.
          </h1>

          {/* Subtext */}
          <p className="reveal mt-6 max-w-2xl text-lg text-white/80 leading-relaxed">
            CropSathi bridges satellite remote sensing with AI-powered leaf
            pathology diagnostics — flagging crop stress, water deficits, and
            disease outbreaks before they become irreversible.
          </p>

          {/* CTAs */}
          <div className="reveal mt-8 flex flex-col gap-4 sm:flex-row">
            <a
              href="#cta"
              className="btn-3d-white group inline-flex items-center justify-center gap-2 rounded-full px-8 py-4 text-base font-bold"
            >
              Get Started
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
            </a>
            <a
              href="#how-it-works"
              className="inline-flex items-center justify-center gap-2 rounded-full border-2 border-white/40 bg-white/5 px-8 py-4 text-base font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/15 hover:border-white/60"
            >
              See How It Works
            </a>
          </div>

          {/* Floating badges */}
          <div className="reveal mt-12 flex flex-wrap gap-4">
            {floatingBadges.map((badge) => (
              <div
                key={badge.label}
                className="glass-badge flex items-center gap-2.5 rounded-2xl px-4 py-3"
              >
                <badge.icon className="h-5 w-5 text-[#006038]" strokeWidth={2} />
                <span className="text-sm font-semibold text-[#1b1c1c]">
                  {badge.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2">
        <div className="flex h-10 w-6 items-start justify-center rounded-full border-2 border-white/30 p-1.5">
          <div className="h-2 w-1 animate-bounce rounded-full bg-white/60" />
        </div>
      </div>
    </section>
  );
}
