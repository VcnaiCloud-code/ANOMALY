export type CatalogSection = 'one_shots' | 'beats' | 'samples';

export type SoundCategory =
  | '808 & Bass'
  | 'Drums & Percussion'
  | 'Melodies & Synths'
  | 'Vocals & Chops'
  | 'FX & Textures'
  | 'One-Shots';

export type AudioFormat = 'WAV' | 'AIFF' | 'MP3' | 'ZIP';
export type ProductType = 'drum_kit' | 'sample_pack' | 'bundle';

export interface SoundItem {
  id: string;
  section: CatalogSection;
  title: string;
  category: string; // e.g. '808 Sub', 'Punch Kick', 'Snare Crack', 'Vocal Loop', 'Instrumental Beat'
  bpm?: number;
  key?: string;
  duration: number; // in seconds
  format: string; // 'WAV 24-bit', 'MP3', 'ZIP'
  fileSize: string;
  coverImage: string;
  audioBlobId?: string;
  audioUrl?: string;
  audioStoragePath?: string;
  syntheticType?: '808' | 'kick' | 'snare' | 'hihat' | 'synth' | 'vocal' | 'riser' | 'beat_dembow' | 'beat_trap';
  isFree: boolean;
  price?: number;
  isPublished: boolean;
  downloads: number;
  description?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface SoundTrack {
  id: string;
  title: string;
  category: SoundCategory;
  bpm: number;
  key: string;
  duration: number;
  format: AudioFormat;
  fileSize: string;
  tags: string[];
  packId?: string;
  packTitle?: string;
  waveformData: number[];
  audioUrl?: string;
  syntheticType?: '808' | 'kick' | 'snare' | 'hihat' | 'synth' | 'vocal' | 'riser';
  downloadCount: number;
  playCount: number;
  isFree: boolean;
  price?: number;
  author: string;
  createdAt: string;
  description?: string;
}

export interface SoundProduct {
  id: string;
  title: string;
  subtitle: string;
  coverImage: string;
  type: ProductType;
  category: SoundCategory;
  trackCount: number;
  totalSize: string;
  formats: AudioFormat[];
  isFree: boolean;
  price: number;
  regularPrice?: number;
  rating: number;
  downloads: number;
  description: string;
  tags: string[];
  badge?: string;
  demoTrack: SoundTrack;
  tracks: SoundTrack[];
  includedItems?: string[];
  featured?: boolean;
}

export type SamplePack = SoundProduct;

export interface CartItem {
  product: SoundProduct;
  quantity: number;
  addedAt: number;
}

export interface Order {
  id: string;
  customerEmail: string;
  customerName: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: 'stripe' | 'mercadopago' | 'crypto' | 'free_checkout' | 'whatsapp';
  status: 'completed' | 'processing';
  createdAt: string;
  downloadAccessList: {
    productId: string;
    productTitle: string;
    format: string;
    size: string;
  }[];
}

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  role: 'producer' | 'admin' | 'vip';
  avatar?: string;
  favorites: string[];
  libraryPacks: string[];
  downloadHistory: { trackId: string; title: string; timestamp: number }[];
}

export interface StorageConfig {
  provider: 'indexeddb' | 'supabase' | 'cloudflare_r2';
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  r2BucketName?: string;
  r2AccountId?: string;
  r2AccessKeyId?: string;
  r2Endpoint?: string;
  stripePublicKey?: string;
  whatsappNumber?: string;
}
