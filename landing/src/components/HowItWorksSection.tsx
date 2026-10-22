import {
  MapPin,
  Satellite,
  Camera,
  FileText,
  ArrowRight,
} from 'lucide-react';

const steps = [
  {
    icon: MapPin,
    step: '01',
    title: 'Draw Your Field Boundary',
    description:
      'Use Leaflet-powered interactive maps to trace your field parcel and register your crop type and growth stage.',
  },
  {
    icon: Satellite,
    step: '02',
    title: 'Satellite Monitors Automatically',
    description:
      'CropSathi pulls Sentinel-2 and Landsat imagery on a schedule, computing NDVI, NDRE, and CWSI health indices for your parcel.',
  },
  {
    icon: Camera,
    step: '03',
    title: 'Snap a Leaf Photo',
    description:
      'When satellite flags stress, upload or capture a photo of the affected leaf. The CNN identifies the disease from 38 classes.',
  },
  {
    icon: FileText,
    step: '04',
    title: 'Get Your Prescription',
    description:
      'Gemini vision AI synthesizes a remedy with dosage, timing, and follow-up — delivered straight to your advisory feed.',
  },
];

export default function HowItWorksSection() {
  return (
    <section
      id="how-it-works"
      className="relative overflow-hidden bg-surface py-24 lg:py-32"
    >
      {/* Background image */}
      <div className="absolute inset-0">
        <img
          src="https://images.pexels.com/photos/16678079/pexels-photo-16678079.jpeg?auto=compress&cs=tinysrgb&h=650&w=940"
          alt="Farmer using smartphone in field"
          className="h-full w-full object-cover opacity-5"
        />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-6">
        {/* Heading */}
        <div className="reveal mx-auto max-w-3xl text-center">
          <span className="text-sm font-bold uppercase tracking-widest text-[#933302]">
            How It Works
          </span>
          <h2 className="mt-4 text-4xl font-bold text-on-surface sm:text-5xl tracking-tight font-display">
            From farm gate to prescription
          </h2>
          <p className="mt-6 text-lg text-on-surface-variant leading-relaxed">
            Four simple steps connect satellite intelligence to your field in
            real time.
          </p>
        </div>

        {/* Steps */}
        <div className="mt-20 grid gap-8 lg:grid-cols-4">
          {steps.map((step, i) => (
            <div key={step.step} className="reveal relative">
              {/* Connector line */}
              {i < steps.length - 1 && (
                <div className="absolute top-8 left-full hidden h-px w-full bg-gradient-to-r from-[#006038]/25 to-transparent lg:block" />
              )}

              <div className="step-3d relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#007a45] to-[#006038]">
                <step.icon className="h-7 w-7 text-white" strokeWidth={2} />
                <span className="absolute -top-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full bg-[#933302] text-xs font-bold text-white">
                  {step.step}
                </span>
              </div>

              <h3 className="mt-6 text-lg font-bold text-on-surface">
                {step.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
                {step.description}
              </p>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="reveal mt-16 text-center">
          <a
            href="#cta"
            className="btn-3d group inline-flex items-center gap-2 rounded-full px-8 py-4 text-base font-bold text-white"
          >
            Try the full flow
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
          </a>
        </div>
      </div>
    </section>
  );
}
