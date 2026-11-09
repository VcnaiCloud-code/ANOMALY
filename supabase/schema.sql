-- ==============================================================================
-- ANOMALY SOUND - SUPABASE MASTER DATABASE & STORAGE SCHEMA
-- ==============================================================================
-- Ejecuta este script en el SQL Editor de tu proyecto Supabase (Dashboard -> SQL Editor -> New Query).
-- Configura las tablas para catálogo, órdenes de PayPal, tokens seguros de descarga
-- y políticas de seguridad RLS (Row Level Security).
-- ==============================================================================

-- 1. TABLA: CATÁLOGO DE PRODUCTOS Y SONIDOS (sound_items)
CREATE TABLE IF NOT EXISTS public.sound_items (
    id TEXT PRIMARY KEY,
    section TEXT NOT NULL CHECK (section IN ('one_shots', 'beats', 'samples')),
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    bpm INTEGER,
    key TEXT,
    duration NUMERIC(6, 2) NOT NULL DEFAULT 1.0,
    format TEXT NOT NULL DEFAULT 'WAV 24-bit',
    file_size TEXT NOT NULL DEFAULT '10 MB',
    cover_image TEXT,
    audio_storage_path TEXT,          -- Ruta en bucket privado 'anomaly-audio-masters'
    audio_url TEXT,                   -- URL pública o preview
    synthetic_type TEXT DEFAULT 'synth',
    is_free BOOLEAN NOT NULL DEFAULT true,
    price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    is_published BOOLEAN NOT NULL DEFAULT true,
    downloads INTEGER NOT NULL DEFAULT 0,
    description TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para optimizar consultas del catálogo público
CREATE INDEX IF NOT EXISTS idx_sound_items_section ON public.sound_items(section);
CREATE INDEX IF NOT EXISTS idx_sound_items_published ON public.sound_items(is_published);
CREATE INDEX IF NOT EXISTS idx_sound_items_created ON public.sound_items(created_at DESC);

-- 2. TABLA: ÓRDENES Y COMPRAS DE PAYPAL (orders)
CREATE TABLE IF NOT EXISTS public.orders (
    order_id TEXT PRIMARY KEY,
    paypal_capture_id TEXT,
    item_id TEXT REFERENCES public.sound_items(id) ON DELETE SET NULL,
    item_title TEXT NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    buyer_email TEXT,
    buyer_name TEXT,
    status TEXT NOT NULL CHECK (status IN ('CREATED', 'COMPLETED', 'FAILED', 'REFUNDED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    captured_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON public.orders(buyer_email);
CREATE INDEX IF NOT EXISTS idx_orders_created ON public.orders(created_at DESC);

-- 3. TABLA: TOKENS DE DESCARGA SEGURA TEMPORAL (download_tokens)
CREATE TABLE IF NOT EXISTS public.download_tokens (
    token TEXT PRIMARY KEY,
    order_id TEXT REFERENCES public.orders(order_id) ON DELETE CASCADE,
    item_id TEXT REFERENCES public.sound_items(id) ON DELETE CASCADE,
    buyer_email TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    download_count INTEGER NOT NULL DEFAULT 0,
    max_downloads INTEGER NOT NULL DEFAULT 5,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tokens_expires ON public.download_tokens(expires_at);

-- 4. TABLA: REGISTRO DE AUDITORÍA DE DESCARGAS (download_logs)
CREATE TABLE IF NOT EXISTS public.download_logs (
    id BIGSERIAL PRIMARY KEY,
    token TEXT REFERENCES public.download_tokens(token) ON DELETE CASCADE,
    item_id TEXT,
    ip_address TEXT,
    user_agent TEXT,
    downloaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 5. ROW LEVEL SECURITY (RLS) - POLÍTICAS DE ACCESO
-- ==============================================================================

-- Habilitar RLS en todas las tablas
ALTER TABLE public.sound_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.download_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.download_logs ENABLE ROW LEVEL SECURITY;

-- Reglas para sound_items:
-- Lectura pública permitida únicamente para productos publicados
DROP POLICY IF EXISTS "Public can view published sound items" ON public.sound_items;
CREATE POLICY "Public can view published sound items"
    ON public.sound_items
    FOR SELECT
    USING (is_published = true);

-- Acceso total a sound_items mediante service_role (Servidor backend)
DROP POLICY IF EXISTS "Service role full access on sound_items" ON public.sound_items;
CREATE POLICY "Service role full access on sound_items"
    ON public.sound_items
    FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role' OR current_user = 'postgres')
    WITH CHECK (auth.jwt() ->> 'role' = 'service_role' OR current_user = 'postgres');

-- Reglas para orders:
-- Estrictamente restringido al servidor (service_role)
DROP POLICY IF EXISTS "Service role full access on orders" ON public.orders;
CREATE POLICY "Service role full access on orders"
    ON public.orders
    FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role' OR current_user = 'postgres')
    WITH CHECK (auth.jwt() ->> 'role' = 'service_role' OR current_user = 'postgres');

-- Reglas para download_tokens:
-- Estrictamente restringido al servidor (service_role)
DROP POLICY IF EXISTS "Service role full access on download_tokens" ON public.download_tokens;
CREATE POLICY "Service role full access on download_tokens"
    ON public.download_tokens
    FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role' OR current_user = 'postgres')
    WITH CHECK (auth.jwt() ->> 'role' = 'service_role' OR current_user = 'postgres');

-- Reglas para download_logs:
DROP POLICY IF EXISTS "Service role full access on download_logs" ON public.download_logs;
CREATE POLICY "Service role full access on download_logs"
    ON public.download_logs
    FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role' OR current_user = 'postgres')
    WITH CHECK (auth.jwt() ->> 'role' = 'service_role' OR current_user = 'postgres');

-- ==============================================================================
-- 6. CONFIGURACIÓN DE STORAGE BUCKETS EN SUPABASE
-- ==============================================================================
-- Inserta la configuración de los dos buckets necesarios si no existen:
-- 1. 'anomaly-covers': Público (lectura directa para carátulas).
-- 2. 'anomaly-audio-masters': PRIVADO (acceso exclusivo mediante URLs firmadas temporales o server-proxy).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
    (
        'anomaly-covers',
        'anomaly-covers',
        true,
        10485760, -- 10 MB límite
        ARRAY['image/jpeg', 'image/png', 'image/webp']
    ),
    (
        'anomaly-audio-masters',
        'anomaly-audio-masters',
        false, -- PRIVADO: No accesible públicamente por URL directa
        524288000, -- 500 MB límite
        ARRAY['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/aiff', 'audio/x-aiff', 'application/zip', 'application/x-zip-compressed']
    )
ON CONFLICT (id) DO NOTHING;

-- Políticas de Storage para anomaly-covers (público de lectura):
DROP POLICY IF EXISTS "Public can view covers" ON storage.objects;
CREATE POLICY "Public can view covers"
    ON storage.objects
    FOR SELECT
    USING (bucket_id = 'anomaly-covers');

-- Políticas de Storage para anomaly-audio-masters (privado):
-- Ningún usuario anónimo puede leer directamente del bucket de audios
DROP POLICY IF EXISTS "Service role full access on audio masters" ON storage.objects;
CREATE POLICY "Service role full access on audio masters"
    ON storage.objects
    FOR ALL
    USING (bucket_id = 'anomaly-audio-masters' AND (auth.jwt() ->> 'role' = 'service_role' OR current_user = 'postgres'))
    WITH CHECK (bucket_id = 'anomaly-audio-masters' AND (auth.jwt() ->> 'role' = 'service_role' OR current_user = 'postgres'));
