import { useReveal } from '@/hooks/useReveal';
import Navbar from '@/components/Navbar';
import Hero from '@/components/Hero';
import ProblemSection from '@/components/ProblemSection';
import TwoTieredSection from '@/components/TwoTieredSection';
import HowItWorksSection from '@/components/HowItWorksSection';
import FeaturesSection from '@/components/FeaturesSection';
import StatsSection from '@/components/StatsSection';
import CtaFooter from '@/components/CtaFooter';

function App() {
  useReveal();

  return (
    <div className="min-h-screen bg-[#fbf9f8]">
      <Navbar />
      <main>
        <Hero />
        {/* off-white */}
        <ProblemSection />
        {/* mint green */}
        <TwoTieredSection />
        {/* off-white */}
        <HowItWorksSection />
        {/* mint green */}
        <FeaturesSection />
        {/* dark green band */}
        <StatsSection />
        {/* off-white + footer */}
        <CtaFooter />
      </main>
    </div>
  );
}

export default App;
