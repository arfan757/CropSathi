import { EyeOff, Satellite, Camera, AlertTriangle } from 'lucide-react';

const problems = [
  {
    icon: AlertTriangle,
    title: 'Reactive Scouting',
    description:
      'Farmers identify fungal blights, rusts, and viral infections only after leaves wilt or lesions cover whole canopies.',
  },
  {
    icon: Satellite,
    title: 'Satellite False Alarms',
    description:
      'Vegetation indices from satellite imagery generate false alarms over mixed pixels and urban rooftops.',
  },
  {
    icon: Camera,
    title: 'Blind to Canopy Health',
    description:
      'Standalone vision apps cannot assess crop canopy vigor or irrigation stress across whole field parcels.',
  },
  {
    icon: EyeOff,
    title: 'No Early Warning',
    description:
      'By the time symptoms are visible in the field, the window for preventive action has already closed.',
  },
];

export default function ProblemSection() {
  return (
    <section id="problem" className="bg-surface py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-6">
        {/* Heading */}
        <div className="reveal mx-auto max-w-3xl text-center">
          <span className="text-sm font-bold uppercase tracking-widest text-[#933302]">
            The Problem
          </span>
          <h2 className="mt-4 text-4xl font-bold text-on-surface sm:text-5xl tracking-tight font-display">
            Traditional crop scouting is{' '}
            <span className="text-[#006038]">reactive</span>
          </h2>
          <p className="mt-6 text-lg text-on-surface-variant leading-relaxed">
            Farmers lose yields because the tools they have either see too much
            or too little — and never soon enough.
          </p>
        </div>

        {/* Grid */}
        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {problems.map((problem) => (
            <div
              key={problem.title}
              className="reveal card-3d group rounded-2xl p-7"
            >
              <div className="icon-3d-terracotta mb-5 flex h-12 w-12 items-center justify-center rounded-xl">
                <problem.icon className="h-6 w-6 text-white" strokeWidth={2} />
              </div>
              <h3 className="text-lg font-bold text-on-surface">
                {problem.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
                {problem.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
