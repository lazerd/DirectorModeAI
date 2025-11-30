import Link from 'next/link';
import { 
  Trophy, 
  Shuffle, 
  Clock, 
  Wrench,
  Users,
  Calendar,
  Mail,
  QrCode,
  Zap,
  CheckCircle,
  ArrowRight,
  Sparkles
} from 'lucide-react';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-subtle">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-primary flex items-center justify-center">
                <Trophy size={20} className="text-white" />
              </div>
              <span className="font-display text-xl">Director Mode AI</span>
            </Link>
            <div className="flex items-center gap-3">
              <Link href="/login" className="btn btn-ghost">
                Sign In
              </Link>
              <Link href="/register" className="btn btn-primary">
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-16 sm:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-light text-primary text-sm font-medium mb-6">
            <Sparkles size={16} />
            The Complete Tennis & Racket Sports Platform
          </div>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl mb-6">
            Three Powerful Tools.
            <br />
            <span className="text-primary">One Platform.</span>
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto mb-10">
            Everything you need to run events, manage lessons, and operate your pro shop — 
            all in one place with AI-powered features.
          </p>
        </div>
      </section>

      {/* Tools Grid */}
      <section className="pb-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
            
            {/* MixerMode Card */}
            <div className="tool-card tool-card-mixer card p-6 lg:p-8">
              <div className="w-14 h-14 rounded-2xl bg-gradient-mixer flex items-center justify-center mb-6 shadow-lg">
                <Shuffle size={28} className="text-white" />
              </div>
              <div className="badge badge-mixer mb-4">EVENTS & MIXERS</div>
              <h2 className="font-display text-2xl mb-3">MixerMode AI</h2>
              <p className="text-gray-600 mb-6">
                Run round robins, generate balanced teams, manage brackets, and check in players with QR codes.
              </p>
              <ul className="space-y-3 mb-8">
                <FeatureItem icon={Users} color="mixer">Smart team generation</FeatureItem>
                <FeatureItem icon={QrCode} color="mixer">QR code check-in</FeatureItem>
                <FeatureItem icon={Trophy} color="mixer">Tournament brackets</FeatureItem>
                <FeatureItem icon={Zap} color="mixer">Real-time scoring</FeatureItem>
              </ul>
              <Link href="/mixer" className="btn btn-mixer w-full">
                Launch MixerMode
                <ArrowRight size={18} />
              </Link>
            </div>

            {/* Lessons Card */}
            <div className="tool-card tool-card-lessons card p-6 lg:p-8">
              <div className="w-14 h-14 rounded-2xl bg-gradient-lessons flex items-center justify-center mb-6 shadow-lg">
                <Clock size={28} className="text-white" />
              </div>
              <div className="badge badge-lessons mb-4">LESSONS & BOOKING</div>
              <h2 className="font-display text-2xl mb-3">LastMinuteLesson</h2>
              <p className="text-gray-600 mb-6">
                Post open slots, notify clients instantly, and let them claim lessons with one click.
              </p>
              <ul className="space-y-3 mb-8">
                <FeatureItem icon={Calendar} color="lessons">Visual calendar</FeatureItem>
                <FeatureItem icon={Mail} color="lessons">Email blasts</FeatureItem>
                <FeatureItem icon={CheckCircle} color="lessons">One-click claiming</FeatureItem>
                <FeatureItem icon={Users} color="lessons">Client management</FeatureItem>
              </ul>
              <Link href="/lessons" className="btn btn-lessons w-full">
                Launch Lessons
                <ArrowRight size={18} />
              </Link>
            </div>

            {/* Stringing Card */}
            <div className="tool-card tool-card-stringing card p-6 lg:p-8">
              <div className="w-14 h-14 rounded-2xl bg-gradient-stringing flex items-center justify-center mb-6 shadow-lg">
                <Wrench size={28} className="text-white" />
              </div>
              <div className="badge badge-stringing mb-4">PRO SHOP</div>
              <h2 className="font-display text-2xl mb-3">StringingMode AI</h2>
              <p className="text-gray-600 mb-6">
                AI-powered string recommendations, job tracking, and automatic pickup notifications.
              </p>
              <ul className="space-y-3 mb-8">
                <FeatureItem icon={Sparkles} color="stringing">AI recommendations</FeatureItem>
                <FeatureItem icon={CheckCircle} color="stringing">Job tracking board</FeatureItem>
                <FeatureItem icon={Mail} color="stringing">Pickup notifications</FeatureItem>
                <FeatureItem icon={Users} color="stringing">Customer history</FeatureItem>
              </ul>
              <Link href="/stringing" className="btn btn-stringing w-full">
                Launch Stringing
                <ArrowRight size={18} />
              </Link>
            </div>

          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="font-display text-3xl sm:text-4xl mb-4">
              Built for Tennis Professionals
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Whether you're a club director, independent coach, or pro shop manager, 
              we've got you covered.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            <FeatureCard
              icon={Users}
              title="Multi-Role Support"
              description="Directors, coaches, and staff each get their own tailored experience."
            />
            <FeatureCard
              icon={Zap}
              title="AI-Powered"
              description="Smart recommendations for string setups, team balancing, and more."
            />
            <FeatureCard
              icon={Mail}
              title="Email Notifications"
              description="Automatic alerts keep customers informed at every step."
            />
            <FeatureCard
              icon={CheckCircle}
              title="Easy to Use"
              description="Clean, intuitive interface that anyone can learn in minutes."
            />
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="card p-8 sm:p-12 bg-gradient-primary text-white">
            <Trophy size={48} className="mx-auto mb-6 opacity-90" />
            <h2 className="font-display text-3xl sm:text-4xl mb-4">
              Ready to Streamline Your Operation?
            </h2>
            <p className="text-white/80 text-lg mb-8 max-w-xl mx-auto">
              Join tennis professionals who are saving hours every week with Director Mode AI.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/register" className="btn btn-lg bg-white text-primary hover:bg-gray-100">
                Create Free Account
              </Link>
              <Link href="/login" className="btn btn-lg bg-white/10 text-white hover:bg-white/20">
                Sign In
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-primary flex items-center justify-center">
                <Trophy size={16} className="text-white" />
              </div>
              <span className="font-display">Director Mode AI</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-gray-600">
              <Link href="/mixer" className="hover:text-primary">MixerMode</Link>
              <Link href="/lessons" className="hover:text-primary">Lessons</Link>
              <Link href="/stringing" className="hover:text-primary">Stringing</Link>
            </div>
            <p className="text-sm text-gray-500">
              © {new Date().getFullYear()} Director Mode AI
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureItem({ 
  icon: Icon, 
  color, 
  children 
}: { 
  icon: React.ElementType; 
  color: 'mixer' | 'lessons' | 'stringing';
  children: React.ReactNode;
}) {
  const colorClasses = {
    mixer: 'text-orange-500',
    lessons: 'text-primary',
    stringing: 'text-purple-500',
  };

  return (
    <div className="flex items-center gap-3 text-sm">
      <Icon size={18} className={colorClasses[color]} />
      <span className="text-gray-700">{children}</span>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="text-center">
      <div className="w-12 h-12 rounded-xl bg-primary-light flex items-center justify-center mx-auto mb-4">
        <Icon size={24} className="text-primary" />
      </div>
      <h3 className="font-display text-lg mb-2">{title}</h3>
      <p className="text-sm text-gray-600">{description}</p>
    </div>
  );
}
