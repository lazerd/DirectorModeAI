'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  ArrowLeft, 
  Search, 
  Plus, 
  User, 
  Sparkles, 
  CheckCircle,
  Clock,
  AlertCircle
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type Customer = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
};

type Racket = {
  id: string;
  brand: string | null;
  model: string | null;
  string_pattern: string | null;
};

type StringCatalog = {
  id: string;
  brand: string;
  name: string;
  string_type: string;
  gauge: string | null;
  in_stock: boolean;
};

type Recommendation = {
  label: string;
  string_catalog_id: string | null;
  string_name: string;
  type: string;
  gauge: string;
  main_tension_lbs: number;
  cross_tension_lbs: number;
  explanation: string;
  arm_friendly: boolean;
};

export default function NewStringingJobPage() {
  const router = useRouter();
  const [step, setStep] = useState<'customer' | 'racket' | 'string' | 'confirm'>('customer');
  
  // Customer state
  const [customerSearch, setCustomerSearch] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ full_name: '', email: '', phone: '' });
  
  // Racket state
  const [rackets, setRackets] = useState<Racket[]>([]);
  const [selectedRacket, setSelectedRacket] = useState<Racket | null>(null);
  const [showNewRacket, setShowNewRacket] = useState(false);
  const [newRacket, setNewRacket] = useState({ brand: '', model: '', string_pattern: '' });
  
  // String state
  const [strings, setStrings] = useState<StringCatalog[]>([]);
  const [selectedString, setSelectedString] = useState<StringCatalog | null>(null);
  const [customStringName, setCustomStringName] = useState('');
  const [mainTension, setMainTension] = useState(52);
  const [crossTension, setCrossTension] = useState<number | null>(null);
  
  // AI state
  const [showAI, setShowAI] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [aiForm, setAiForm] = useState({
    level: 'intermediate',
    play_style: '',
    arm_issues: '',
    preference: 'balanced',
    durability_needs: false,
  });
  
  // Final state
  const [quotedReadyAt, setQuotedReadyAt] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Search customers
  useEffect(() => {
    if (customerSearch.length >= 2) {
      searchCustomers();
    }
  }, [customerSearch]);

  // Load rackets when customer selected
  useEffect(() => {
    if (selectedCustomer) {
      fetchRackets();
    }
  }, [selectedCustomer]);

  // Load strings catalog
  useEffect(() => {
    fetchStrings();
  }, []);

  const searchCustomers = async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('stringing_customers')
      .select('*')
      .or(`full_name.ilike.%${customerSearch}%,email.ilike.%${customerSearch}%`)
      .limit(10);
    
    if (data) setCustomers(data);
  };

  const fetchRackets = async () => {
    if (!selectedCustomer) return;
    const supabase = createClient();
    const { data } = await supabase
      .from('stringing_rackets')
      .select('*')
      .eq('customer_id', selectedCustomer.id);
    
    if (data) setRackets(data);
  };

  const fetchStrings = async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('stringing_catalog')
      .select('*')
      .eq('in_stock', true)
      .order('brand');
    
    if (data) setStrings(data);
  };

  const createCustomer = async () => {
    if (!newCustomer.full_name) return;
    
    const supabase = createClient();
    const { data, error } = await supabase
      .from('stringing_customers')
      .insert(newCustomer)
      .select()
      .single();
    
    if (data) {
      setSelectedCustomer(data);
      setShowNewCustomer(false);
      setStep('racket');
    }
  };

  const createRacket = async () => {
    if (!selectedCustomer || !newRacket.brand) return;
    
    const supabase = createClient();
    const { data, error } = await supabase
      .from('stringing_rackets')
      .insert({ ...newRacket, customer_id: selectedCustomer.id })
      .select()
      .single();
    
    if (data) {
      setSelectedRacket(data);
      setShowNewRacket(false);
      setStep('string');
    }
  };

  const getAIRecommendations = async () => {
    setAiLoading(true);
    try {
      const res = await fetch('/api/stringing/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiForm),
      });
      
      const data = await res.json();
      if (data.recommendations) {
        setRecommendations(data.recommendations);
      }
    } catch (err) {
      console.error('AI error:', err);
    } finally {
      setAiLoading(false);
    }
  };

  const selectRecommendation = (rec: Recommendation) => {
    if (rec.string_catalog_id) {
      const catalogString = strings.find(s => s.id === rec.string_catalog_id);
      if (catalogString) setSelectedString(catalogString);
    } else {
      setCustomStringName(rec.string_name);
    }
    setMainTension(rec.main_tension_lbs);
    setCrossTension(rec.cross_tension_lbs !== rec.main_tension_lbs ? rec.cross_tension_lbs : null);
    setShowAI(false);
    setStep('confirm');
  };

  const createJob = async () => {
    if (!selectedCustomer) return;
    
    setLoading(true);
    setError('');
    
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    const jobData = {
      customer_id: selectedCustomer.id,
      racket_id: selectedRacket?.id || null,
      string_id: selectedString?.id || null,
      custom_string_name: selectedString ? null : customStringName,
      main_tension_lbs: mainTension,
      cross_tension_lbs: crossTension,
      status: 'pending',
      requested_by_user_id: user?.id,
      quoted_ready_at: quotedReadyAt || null,
      internal_notes: internalNotes || null,
      play_style: aiForm.play_style || null,
      skill_level: aiForm.level,
      arm_issues: aiForm.arm_issues || null,
    };

    const { data, error } = await supabase
      .from('stringing_jobs')
      .insert(jobData)
      .select()
      .single();

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push('/stringing/jobs');
  };

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="page-enter">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link href="/stringing/jobs" className="btn btn-ghost btn-icon">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="font-display text-2xl">New Stringing Job</h1>
            <p className="text-gray-500 text-sm">
              Step {step === 'customer' ? '1' : step === 'racket' ? '2' : step === 'string' ? '3' : '4'} of 4
            </p>
          </div>
        </div>

        {/* Progress */}
        <div className="flex gap-2 mb-8">
          {['customer', 'racket', 'string', 'confirm'].map((s, i) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full ${
                ['customer', 'racket', 'string', 'confirm'].indexOf(step) >= i
                  ? 'bg-stringing'
                  : 'bg-gray-200'
              }`}
            />
          ))}
        </div>

        {/* Step 1: Customer */}
        {step === 'customer' && (
          <div className="card p-6">
            <h2 className="font-display text-lg mb-4">Find or Create Customer</h2>
            
            {!showNewCustomer ? (
              <>
                <div className="relative mb-4">
                  <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    className="input pl-11"
                    placeholder="Search by name or email..."
                  />
                </div>

                {customers.length > 0 && (
                  <div className="space-y-2 mb-4">
                    {customers.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setSelectedCustomer(c);
                          setStep('racket');
                        }}
                        className="w-full p-3 rounded-xl border border-gray-200 hover:border-stringing hover:bg-stringing-light text-left transition-colors"
                      >
                        <div className="font-medium">{c.full_name}</div>
                        <div className="text-sm text-gray-500">{c.email || c.phone || 'No contact info'}</div>
                      </button>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => setShowNewCustomer(true)}
                  className="btn btn-secondary w-full"
                >
                  <Plus size={18} />
                  Create New Customer
                </button>
              </>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="label">Full Name *</label>
                  <input
                    type="text"
                    value={newCustomer.full_name}
                    onChange={(e) => setNewCustomer({ ...newCustomer, full_name: e.target.value })}
                    className="input"
                    placeholder="John Smith"
                  />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input
                    type="email"
                    value={newCustomer.email}
                    onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                    className="input"
                    placeholder="john@example.com"
                  />
                </div>
                <div>
                  <label className="label">Phone</label>
                  <input
                    type="tel"
                    value={newCustomer.phone}
                    onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                    className="input"
                    placeholder="(555) 123-4567"
                  />
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setShowNewCustomer(false)} className="btn btn-secondary flex-1">
                    Cancel
                  </button>
                  <button onClick={createCustomer} className="btn btn-stringing flex-1">
                    Create Customer
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Racket */}
        {step === 'racket' && (
          <div className="card p-6">
            <h2 className="font-display text-lg mb-4">Select Racket</h2>
            <p className="text-sm text-gray-500 mb-4">For: {selectedCustomer?.full_name}</p>
            
            {!showNewRacket ? (
              <>
                {rackets.length > 0 && (
                  <div className="space-y-2 mb-4">
                    {rackets.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => {
                          setSelectedRacket(r);
                          setStep('string');
                        }}
                        className="w-full p-3 rounded-xl border border-gray-200 hover:border-stringing hover:bg-stringing-light text-left transition-colors"
                      >
                        <div className="font-medium">{r.brand} {r.model}</div>
                        {r.string_pattern && (
                          <div className="text-sm text-gray-500">{r.string_pattern}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => setShowNewRacket(true)}
                  className="btn btn-secondary w-full mb-3"
                >
                  <Plus size={18} />
                  Add New Racket
                </button>
                <button
                  onClick={() => setStep('string')}
                  className="btn btn-ghost w-full text-sm"
                >
                  Skip (no specific racket)
                </button>
              </>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="label">Brand *</label>
                  <input
                    type="text"
                    value={newRacket.brand}
                    onChange={(e) => setNewRacket({ ...newRacket, brand: e.target.value })}
                    className="input"
                    placeholder="Wilson, Babolat, Head..."
                  />
                </div>
                <div>
                  <label className="label">Model</label>
                  <input
                    type="text"
                    value={newRacket.model}
                    onChange={(e) => setNewRacket({ ...newRacket, model: e.target.value })}
                    className="input"
                    placeholder="Pro Staff, Pure Aero..."
                  />
                </div>
                <div>
                  <label className="label">String Pattern</label>
                  <input
                    type="text"
                    value={newRacket.string_pattern}
                    onChange={(e) => setNewRacket({ ...newRacket, string_pattern: e.target.value })}
                    className="input"
                    placeholder="16x19"
                  />
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setShowNewRacket(false)} className="btn btn-secondary flex-1">
                    Cancel
                  </button>
                  <button onClick={createRacket} className="btn btn-stringing flex-1">
                    Add Racket
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: String Selection */}
        {step === 'string' && (
          <div className="card p-6">
            <h2 className="font-display text-lg mb-4">Choose String & Tension</h2>
            
            {/* AI Recommendation Button */}
            {!showAI && (
              <button
                onClick={() => setShowAI(true)}
                className="w-full p-4 rounded-xl border-2 border-dashed border-stringing/30 hover:border-stringing hover:bg-stringing-light text-center mb-6 transition-colors"
              >
                <Sparkles size={24} className="mx-auto text-stringing mb-2" />
                <div className="font-medium text-stringing">Get AI Recommendation</div>
                <div className="text-sm text-gray-500">Answer a few questions for personalized suggestions</div>
              </button>
            )}

            {/* AI Form */}
            {showAI && (
              <div className="mb-6 p-4 bg-stringing-light rounded-xl">
                <h3 className="font-display mb-4 flex items-center gap-2">
                  <Sparkles size={18} className="text-stringing" />
                  AI String Advisor
                </h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="label">Skill Level</label>
                    <select
                      value={aiForm.level}
                      onChange={(e) => setAiForm({ ...aiForm, level: e.target.value })}
                      className="input"
                    >
                      <option value="beginner">Beginner (1.0 - 2.5)</option>
                      <option value="intermediate">Intermediate (3.0 - 3.5)</option>
                      <option value="advanced">Advanced (4.0 - 4.5)</option>
                      <option value="college">College / USTA 5.0+</option>
                      <option value="pro">Professional</option>
                    </select>
                  </div>

                  <div>
                    <label className="label">Play Style</label>
                    <input
                      type="text"
                      value={aiForm.play_style}
                      onChange={(e) => setAiForm({ ...aiForm, play_style: e.target.value })}
                      className="input"
                      placeholder="e.g., aggressive baseliner, serve & volley..."
                    />
                  </div>

                  <div>
                    <label className="label">Arm/Shoulder Issues?</label>
                    <input
                      type="text"
                      value={aiForm.arm_issues}
                      onChange={(e) => setAiForm({ ...aiForm, arm_issues: e.target.value })}
                      className="input"
                      placeholder="e.g., tennis elbow, shoulder pain, or leave blank"
                    />
                  </div>

                  <div>
                    <label className="label">Primary Preference</label>
                    <select
                      value={aiForm.preference}
                      onChange={(e) => setAiForm({ ...aiForm, preference: e.target.value })}
                      className="input"
                    >
                      <option value="balanced">Balanced</option>
                      <option value="power">Power</option>
                      <option value="control">Control</option>
                      <option value="spin">Spin</option>
                      <option value="comfort">Comfort / Arm-friendly</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="durability"
                      checked={aiForm.durability_needs}
                      onChange={(e) => setAiForm({ ...aiForm, durability_needs: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <label htmlFor="durability" className="text-sm">
                      Breaks strings frequently (prioritize durability)
                    </label>
                  </div>

                  <div className="flex gap-3">
                    <button onClick={() => setShowAI(false)} className="btn btn-secondary flex-1">
                      Cancel
                    </button>
                    <button 
                      onClick={getAIRecommendations} 
                      className="btn btn-stringing flex-1"
                      disabled={aiLoading}
                    >
                      {aiLoading ? (
                        <>
                          <span className="spinner" />
                          Thinking...
                        </>
                      ) : (
                        <>
                          <Sparkles size={18} />
                          Get Recommendations
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Recommendations */}
                {recommendations.length > 0 && (
                  <div className="mt-6 space-y-3">
                    <h4 className="font-medium text-sm text-gray-600">Recommendations:</h4>
                    {recommendations.map((rec, i) => (
                      <button
                        key={i}
                        onClick={() => selectRecommendation(rec)}
                        className="w-full p-4 bg-white rounded-xl border border-gray-200 hover:border-stringing text-left transition-colors"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="font-medium">{rec.label}</div>
                          {rec.arm_friendly && (
                            <span className="badge badge-success text-xs">Arm-friendly</span>
                          )}
                        </div>
                        <div className="text-sm text-gray-600 mb-1">
                          {rec.string_name} • {rec.gauge} gauge
                        </div>
                        <div className="text-sm text-gray-600 mb-2">
                          {rec.main_tension_lbs}/{rec.cross_tension_lbs} lbs
                        </div>
                        <div className="text-xs text-gray-500">{rec.explanation}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Manual Selection */}
            <div className="space-y-4">
              <div>
                <label className="label">String (from catalog)</label>
                <select
                  value={selectedString?.id || ''}
                  onChange={(e) => {
                    const s = strings.find(str => str.id === e.target.value);
                    setSelectedString(s || null);
                    if (s) setCustomStringName('');
                  }}
                  className="input"
                >
                  <option value="">-- Select from catalog --</option>
                  {strings.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.brand} {s.name} ({s.string_type}, {s.gauge})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Or Custom String Name</label>
                <input
                  type="text"
                  value={customStringName}
                  onChange={(e) => {
                    setCustomStringName(e.target.value);
                    if (e.target.value) setSelectedString(null);
                  }}
                  className="input"
                  placeholder="Customer's own string..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Main Tension (lbs) *</label>
                  <input
                    type="number"
                    value={mainTension}
                    onChange={(e) => setMainTension(Number(e.target.value))}
                    className="input"
                    min={30}
                    max={70}
                  />
                </div>
                <div>
                  <label className="label">Cross Tension (lbs)</label>
                  <input
                    type="number"
                    value={crossTension || ''}
                    onChange={(e) => setCrossTension(e.target.value ? Number(e.target.value) : null)}
                    className="input"
                    placeholder="Same as mains"
                    min={30}
                    max={70}
                  />
                </div>
              </div>

              <button
                onClick={() => setStep('confirm')}
                className="btn btn-stringing w-full"
                disabled={!selectedString && !customStringName}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Confirm */}
        {step === 'confirm' && (
          <div className="card p-6">
            <h2 className="font-display text-lg mb-4">Confirm Job Details</h2>
            
            <div className="space-y-4 mb-6">
              <div className="p-4 bg-gray-50 rounded-xl">
                <div className="text-sm text-gray-500 mb-1">Customer</div>
                <div className="font-medium">{selectedCustomer?.full_name}</div>
              </div>

              {selectedRacket && (
                <div className="p-4 bg-gray-50 rounded-xl">
                  <div className="text-sm text-gray-500 mb-1">Racket</div>
                  <div className="font-medium">{selectedRacket.brand} {selectedRacket.model}</div>
                </div>
              )}

              <div className="p-4 bg-gray-50 rounded-xl">
                <div className="text-sm text-gray-500 mb-1">String</div>
                <div className="font-medium">
                  {selectedString ? `${selectedString.brand} ${selectedString.name}` : customStringName}
                </div>
              </div>

              <div className="p-4 bg-gray-50 rounded-xl">
                <div className="text-sm text-gray-500 mb-1">Tension</div>
                <div className="font-medium">
                  {crossTension ? `${mainTension}/${crossTension} lbs` : `${mainTension} lbs`}
                </div>
              </div>

              <div>
                <label className="label">Estimated Ready Time</label>
                <select
                  value={quotedReadyAt}
                  onChange={(e) => setQuotedReadyAt(e.target.value)}
                  className="input"
                >
                  <option value="">Select...</option>
                  <option value={new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()}>
                    2 hours
                  </option>
                  <option value={new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()}>
                    4 hours
                  </option>
                  <option value={new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()}>
                    Tomorrow
                  </option>
                </select>
              </div>

              <div>
                <label className="label">Internal Notes</label>
                <textarea
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  className="input"
                  rows={3}
                  placeholder="Notes for staff..."
                />
              </div>
            </div>

            {error && (
              <div className="alert alert-error mb-4">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setStep('string')} className="btn btn-secondary flex-1">
                Back
              </button>
              <button 
                onClick={createJob} 
                className="btn btn-stringing flex-1"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="spinner" />
                    Creating...
                  </>
                ) : (
                  <>
                    <CheckCircle size={18} />
                    Create Job
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
