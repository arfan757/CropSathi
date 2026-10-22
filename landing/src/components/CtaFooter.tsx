import { ArrowRight, Sprout, Github, Mail } from 'lucide-react';

const footerLinks = [
  {
    title: 'Platform',
    links: [
      { label: 'Dashboard', href: '#' },
      { label: 'Field Mapping', href: '#' },
      { label: 'Disease Diagnosis', href: '#' },
      { label: 'Advisory Feed', href: '#' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Architecture', href: 'https://github.com/arfan757/CropSathi/blob/main/docs/ARCHITECTURE.md' },
      { label: 'API Spec', href: 'https://github.com/arfan757/CropSathi/blob/main/docs/BACKEND_SPEC.md' },
      { label: 'Product Spec', href: 'https://github.com/arfan757/CropSathi/blob/main/docs/PRD.md' },
      { label: 'Deployment Guide', href: 'https://github.com/arfan757/CropSathi/blob/main/docs/DEPLOYMENT.md' },
    ],
  },
  {
    title: 'Project',
    links: [
      { label: 'GitHub Repository', href: 'https://github.com/arfan757/CropSathi' },
      { label: 'Documentation', href: 'https://github.com/arfan757/CropSathi/tree/main/docs' },
      { label: 'License (MIT)', href: 'https://github.com/arfan757/CropSathi/blob/main/LICENSE' },
    ],
  },
];

export default function CtaFooter() {
  return (
    <>
      {/* CTA section */}
      <section id="cta" className="relative overflow-hidden bg-surface py-24 lg:py-32">
        <div className="absolute inset-0">
          <img
            src="https://images.pexels.com/photos/39662345/pexels-photo-39662345.jpeg?auto=compress&cs=tinysrgb&h=650&w=940"
            alt="Farmers working in lush green fields"
            className="h-full w-full object-cover opacity-10"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/80 to-surface/60" />
        </div>

        <div className="relative z-10 mx-auto max-w-4xl px-6 text-center">
          <div className="reveal">
            <h2 className="text-4xl font-bold text-on-surface sm:text-5xl tracking-tight font-display">
              Start protecting your fields today
            </h2>
            <p className="mt-6 text-lg text-on-surface-variant leading-relaxed">
              Join the farmers using CropSathi to catch disease early, monitor
              field health from space, and get AI-powered prescriptions when it
              matters most.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <a
                href="#"
                className="btn-3d group inline-flex items-center gap-2 rounded-full px-8 py-4 text-base font-bold text-white"
              >
                Get Started
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </a>
              <a
                href="https://github.com/arfan757/CropSathi"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-3d-tertiary inline-flex items-center gap-2 rounded-full px-8 py-4 text-base font-bold text-white"
              >
                <Github className="h-5 w-5" />
                View on GitHub
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-surface-low pt-16 pb-8 border-t border-outline/15">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-10 lg:grid-cols-5">
            {/* Brand */}
            <div className="lg:col-span-2">
              <a href="#" className="flex items-center gap-2.5">
                <div className="icon-3d-green flex h-10 w-10 items-center justify-center rounded-xl">
                  <Sprout className="h-5 w-5 text-white" strokeWidth={2.5} />
                </div>
                <span className="text-xl font-bold text-on-surface font-display">
                  Crop<span className="text-[#006038]">Sathi</span>
                </span>
              </a>
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-on-surface-variant">
                Early crop disease detection and satellite field health
                intelligence — built for smallholder farmers, village extension
                workers, and agricultural officers.
              </p>
            </div>

            {/* Link columns */}
            {footerLinks.map((col) => (
              <div key={col.title}>
                <h4 className="text-sm font-bold uppercase tracking-wider text-on-surface">
                  {col.title}
                </h4>
                <ul className="mt-4 space-y-3">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        target={link.href.startsWith('http') ? '_blank' : undefined}
                        rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                        className="text-sm text-on-surface-variant transition-colors hover:text-[#006038]"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Bottom bar */}
          <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-outline/15 pt-8 sm:flex-row">
            <p className="text-sm text-on-surface-variant">
              © 2026 CropSathi. Licensed under MIT.
            </p>
            <div className="flex items-center gap-4">
              <a
                href="https://github.com/arfan757/CropSathi"
                target="_blank"
                rel="noopener noreferrer"
                className="text-on-surface-variant transition-colors hover:text-[#006038]"
              >
                <Github className="h-5 w-5" />
              </a>
              <a
                href="#"
                className="text-on-surface-variant transition-colors hover:text-[#006038]"
              >
                <Mail className="h-5 w-5" />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
