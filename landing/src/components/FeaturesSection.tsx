import {
  Bug,
  Satellite,
  CloudRain,
  Languages,
  ClipboardList,
  TrendingUp,
  ShieldCheck,
  Bell,
} from 'lucide-react';

const features = [
  {
    icon: Bug,
    title: '38-Class Disease Detection',
    description:
      'A TensorFlow CNN trained on the PlantVillage dataset identifies blights, rusts, spots, and viral infections across 38 crop classes.',
    useTertiary: true,
  },
  {
    icon: Satellite,
    title: 'Satellite Field Health',
    description:
      'Sentinel-2 and Landsat imagery fused with NDVI, NDRE, and CWSI indices to monitor canopy vigor and irrigation stress.',
    useTertiary: false,
  },
  {
    icon: ShieldCheck,
    title: 'Surface Validation Gatekeeper',
    description:
      'Rejects non-crop pixels (NDVI < 0.20) so satellite false alarms over rooftops and mixed land are eliminated.',
    useTertiary: false,
  },
  {
    icon: CloudRain,
    title: 'Automated Weather Alerts',
    description:
      'Cron-based schedulers pull live weather data and trigger advisories for drought, frost, and heavy rainfall risks.',
    useTertiary: true,
  },
  {
    icon: ClipboardList,
    title: 'Prescription Advisory Feed',
    description:
      'Gemini-powered vision AI synthesizes actionable remedies with dosage, timing, and follow-up scheduling.',
    useTertiary: false,
  },
  {
    icon: Languages,
    title: 'Multilingual Interface',
    description:
      'Full UI support in English, Hindi, and Marathi — built for smallholder farmers and village extension workers.',
    useTertiary: true,
  },
  {
    icon: TrendingUp,
    title: 'Historical Spectral Trends',
    description:
      'Time-series analytics charts let farmers and officers track field health across seasons and intervene early.',
    useTertiary: false,
  },
  {
    icon: Bell,
    title: 'Smart Notification Center',
    description:
      'Urgent alerts, advisories, and system notifications are categorized and delivered in real time to the dashboard.',
    useTertiary: true,
  },
];

export default function FeaturesSection() {
  return (
    <section id="features" className="bg-mint py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-6">
        {/* Heading */}
        <div className="reveal mx-auto max-w-3xl text-center">
          <span className="text-sm font-bold uppercase tracking-widest text-[#933302]">
            Key Features
          </span>
          <h2 className="mt-4 text-4xl font-bold text-on-surface sm:text-5xl tracking-tight font-display">
            Everything a field needs, in one platform
          </h2>
          <p className="mt-6 text-lg text-on-surface-variant leading-relaxed">
            From satellite-scanned field boundaries to AI-prescribed remedies —
            CropSathi covers the full crop health lifecycle.
          </p>
        </div>

        {/* Grid */}
        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="reveal card-3d group rounded-2xl p-6"
            >
              <div
                className={`mb-5 flex h-12 w-12 items-center justify-center rounded-xl ${
                  feature.useTertiary ? 'icon-3d-terracotta' : 'icon-3d-green'
                }`}
              >
                <feature.icon className="h-6 w-6 text-white" strokeWidth={2} />
              </div>
              <h3 className="text-base font-bold text-on-surface">
                {feature.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
