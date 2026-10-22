import { Satellite, Leaf, ArrowDown } from 'lucide-react';

const macroImg =
  'https://images.pexels.com/photos/29277511/pexels-photo-29277511.jpeg?auto=compress&cs=tinysrgb&h=650&w=940';
const microImg =
  'https://images.pexels.com/photos/28166522/pexels-photo-28166522.jpeg?auto=compress&cs=tinysrgb&h=650&w=940';

const macroPoints = [
  'Sentinel-2 optical imagery at 10–20m resolution',
  'Landsat 8/9 thermal bands for water stress',
  'NDVI + NDRE + CWSI three-signal health fusion',
  'Surface validation gatekeeper rejects non-crop pixels',
];

const microPoints = [
  'TensorFlow CNN trained on 38 PlantVillage classes',
  'Google Gemini 1.5 Flash for multimodal diagnosis',
  'Multi-photo camera / image upload flow',
  'Prescription synthesis with follow-up scheduling',
];

export default function TwoTieredSection() {
  return (
    <section className="relative overflow-hidden bg-mint py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-6">
        {/* Heading */}
        <div className="reveal mx-auto max-w-3xl text-center">
          <span className="text-sm font-bold uppercase tracking-widest text-[#933302]">
            Two-Tiered Intelligence
          </span>
          <h2 className="mt-4 text-4xl font-bold text-on-surface sm:text-5xl tracking-tight font-display">
            From the sky to the leaf
          </h2>
          <p className="mt-6 text-lg text-on-surface-variant leading-relaxed">
            CropSathi fuses macro-level satellite remote sensing with
            field-level leaf pathology diagnostics — a pipeline no standalone
            tool can match.
          </p>
        </div>

        {/* Two columns */}
        <div className="mt-16 grid gap-8 lg:grid-cols-2">
          {/* Macro tier */}
          <div className="reveal card-3d group overflow-hidden rounded-3xl">
            <div className="relative h-72 overflow-hidden">
              <img
                src={macroImg}
                alt="Satellite aerial view of agricultural fields"
                className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
              <div className="absolute bottom-4 left-6 flex items-center gap-2">
                <Satellite className="h-5 w-5 text-[#80d9a2]" />
                <span className="text-sm font-semibold text-white">
                  Macro Tier — Satellite
                </span>
              </div>
            </div>
            <div className="bg-white p-7">
              <ul className="space-y-3">
                {macroPoints.map((point) => (
                  <li
                    key={point}
                    className="flex items-start gap-3 text-sm text-on-surface-variant"
                  >
                    <span className="mt-1.5 flex h-1.5 w-1.5 shrink-0 rounded-full bg-[#006038]" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Micro tier */}
          <div className="reveal card-3d group overflow-hidden rounded-3xl">
            <div className="relative h-72 overflow-hidden">
              <img
                src={microImg}
                alt="Close-up of a diseased leaf with brown spots"
                className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
              <div className="absolute bottom-4 left-6 flex items-center gap-2">
                <Leaf className="h-5 w-5 text-[#ffb599]" />
                <span className="text-sm font-semibold text-white">
                  Micro Tier — Leaf Diagnostics
                </span>
              </div>
            </div>
            <div className="bg-white p-7">
              <ul className="space-y-3">
                {microPoints.map((point) => (
                  <li
                    key={point}
                    className="flex items-start gap-3 text-sm text-on-surface-variant"
                  >
                    <span className="mt-1.5 flex h-1.5 w-1.5 shrink-0 rounded-full bg-[#933302]" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Fusion arrow */}
        <div className="reveal mt-12 flex flex-col items-center gap-3 text-center">
          <div className="flex items-center gap-3 text-on-surface-variant/60">
            <div className="h-px w-20 bg-gradient-to-r from-transparent to-[#006038]/40" />
            <ArrowDown className="h-5 w-5 text-[#006038]" />
            <div className="h-px w-20 bg-gradient-to-l from-transparent to-[#006038]/40" />
          </div>
          <p className="max-w-xl text-sm text-on-surface-variant">
            Both tiers feed a single{' '}
            <span className="font-bold text-on-surface">
              health fusion engine
            </span>{' '}
            that scores each field parcel — so farmers get one clear, actionable
            verdict.
          </p>
        </div>
      </div>
    </section>
  );
}
