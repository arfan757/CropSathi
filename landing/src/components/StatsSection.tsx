import { useEffect, useState, useRef } from 'react';

interface Stat {
  value: number;
  suffix: string;
  label: string;
}

const stats: Stat[] = [
  { value: 38, suffix: '', label: 'Plant disease classes detected' },
  { value: 3, suffix: '', label: 'Spectral health indices fused' },
  { value: 10, suffix: 'm', label: 'Minimum satellite resolution' },
  { value: 3, suffix: '', label: 'Languages supported' },
];

function useCountUp(target: number, duration: number, start: boolean) {
  const [count, setCount] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!start) return;
    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(target * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration, start]);

  return count;
}

function StatItem({ stat, start }: { stat: Stat; start: boolean }) {
  const count = useCountUp(stat.value, 1500, start);
  return (
    <div className="text-center">
      <div className="text-5xl font-extrabold text-white sm:text-6xl font-display">
        {count}
        <span className="text-[#ffb599]">{stat.suffix}</span>
      </div>
      <p className="mt-3 text-sm font-medium text-white/70">
        {stat.label}
      </p>
    </div>
  );
}

export default function StatsSection() {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="impact"
      ref={ref}
      className="bg-gradient-to-r from-[#006038] to-[#004025] py-20"
    >
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <StatItem key={stat.label} stat={stat} start={visible} />
          ))}
        </div>
      </div>
    </section>
  );
}
