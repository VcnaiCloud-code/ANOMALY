-- ==============================================================================
-- ANOMALY SOUND - SUPABASE MASTER DATABASE & STORAGE SCHEMA
-- ==============================================================================
-- Versión definitiva y unificada. Compatible con server.ts y supabaseServer.ts.
-- Ejecuta este script en el SQL Editor de tu proyecto Supabase (Dashboard -> SQL Editor -> New Query).
-- Configura tablas para catálogo, órdenes de PayPal, tokens seguros de descarga,
-- auditoría, sesiones administrativas revocadas, rate limiting y RPCs transaccionales.
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

-- Restricción UNIQUE para garantizar un único token canónico por orden:
CREATE UNIQUE INDEX IF NOT EXISTS idx_download_tokens_order_id_unique 
    ON public.download_tokens(order_id)
    WHERE order_id IS NOT NULL;

-- 4. TABLA: REGISTRO DE AUDITORÍA DE DESCARGAS (download_logs)
CREATE TABLE IF NOT EXISTS public.download_logs (
    id BIGSERIAL PRIMARY KEY,
    token TEXT REFERENCES public.download_tokens(token) ON DELETE CASCADE,
    item_id TEXT,
    ip_address TEXT,
    user_agent TEXT,
    downloaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_download_logs_token ON public.download_logs(token);
CREATE INDEX IF NOT EXISTS idx_download_logs_downloaded_at ON public.download_logs(downloaded_at DESC);

-- 5. TABLA: SESIONES ADMINISTRATIVAS REVOCADAS (admin_revoked_sessions)
CREATE TABLE IF NOT EXISTS public.admin_revoked_sessions (
    session_id TEXT PRIMARY KEY,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revoked_sessions_expires ON public.admin_revoked_sessions(expires_at);

-- 6. TABLA: RATE LIMITING DE INTENTOS DE LOGIN (admin_login_attempts)
CREATE TABLE IF NOT EXISTS public.admin_login_attempts (
    ip TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 1,
    first_attempt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    blocked_until TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_blocked ON public.admin_login_attempts(blocked_until);

-- ==============================================================================
-- 7. ROW LEVEL SECURITY (RLS) - POLÍTICAS DE ACCESO
-- ==============================================================================

ALTER TABLE public.sound_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.download_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.download_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_revoked_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_login_attempts ENABLE ROW LEVEL SECURITY;

-- Reglas para sound_items:
DROP POLICY IF EXISTS "Public can view published sound items" ON public.sound_items;
CREATE POLICY "Public can view published sound items"
    ON public.sound_items
    FOR SELECT
    USING (is_published = true);

DROP POLICY IF EXISTS "Service role full access on sound_items" ON public.sound_items;
CREATE POLICY "Service role full access on sound_items"
    ON public.sound_items
    FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role' OR current_user = 'postgres')
    WITH CHECK (auth.jwt() ->> 'role' = 'service_role' OR current_user = 'postgres');

-- Reglas para orders:
DROP POLICY IF EXISTS "Service role full access on orders" ON public.orders;
CREATE POLICY "Service role full access on orders"
    ON public.orders
    FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role' OR current_user = 'postgres')
    WITH CHECK (auth.jwt() ->> 'role' = 'service_role' OR current_user = 'postgres');

-- Reglas para download_tokens:
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

-- Reglas para admin_revoked_sessions:
DROP POLICY IF EXISTS "Service role full access on admin_revoked_sessions" ON public.admin_revoked_sessions;
CREATE POLICY "Service role full access on admin_revoked_sessions"
    ON public.admin_revoked_sessions
    FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role' OR current_user = 'postgres')
    WITH CHECK (auth.jwt() ->> 'role' = 'service_role' OR current_user = 'postgres');

-- Reglas para admin_login_attempts:
DROP POLICY IF EXISTS "Service role full access on admin_login_attempts" ON public.admin_login_attempts;
CREATE POLICY "Service role full access on admin_login_attempts"
    ON public.admin_login_attempts
    FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role' OR current_user = 'postgres')
    WITH CHECK (auth.jwt() ->> 'role' = 'service_role' OR current_user = 'postgres');

-- ==============================================================================
-- 8. FUNCIONES RPC TRANSACCIONALES EN POSTGRESQL
-- ==============================================================================

-- A. Consumo atómico de token con auditoría y protección de concurrencia:
CREATE OR REPLACE FUNCTION public.consume_download_token(
    p_token TEXT,
    p_ip TEXT,
    p_user_agent TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_token RECORD;
BEGIN
    -- Bloquear la fila del token para garantizar exclusión mutua
    SELECT * INTO v_token 
    FROM public.download_tokens 
    WHERE token = p_token 
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Token de descarga no válido o inexistente.');
    END IF;

    IF NOW() > v_token.expires_at THEN
        RETURN jsonb_build_object('valid', false, 'error', 'El enlace de descarga ha expirado (validez: 24 horas).');
    END IF;

    IF v_token.download_count >= v_token.max_downloads THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Se ha alcanzado el límite máximo de descargas para este enlace.');
    END IF;

    -- Incrementar contador atómicamente
    UPDATE public.download_tokens
    SET download_count = download_count + 1
    WHERE token = p_token
    RETURNING * INTO v_token;

    -- Registrar auditoría en download_logs
    INSERT INTO public.download_logs (token, item_id, ip_address, user_agent, downloaded_at)
    VALUES (p_token, v_token.item_id, COALESCE(p_ip, 'unknown'), COALESCE(p_user_agent, 'unknown'), NOW());

    RETURN jsonb_build_object(
        'valid', true,
        'tokenData', row_to_json(v_token)
    );
END;
$$;

-- B. Reserva atómica de captura PayPal (Idempotencia distribuida entre instancias):
CREATE OR REPLACE FUNCTION public.claim_order_for_capture(
    p_order_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order RECORD;
    v_token RECORD;
BEGIN
    SELECT * INTO v_order 
    FROM public.orders 
    WHERE order_id = p_order_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'status', 'NOT_FOUND', 'error', 'Orden no encontrada en la base de datos.');
    END IF;

    IF v_order.status = 'COMPLETED' THEN
        SELECT * INTO v_token
        FROM public.download_tokens
        WHERE order_id = p_order_id
        ORDER BY created_at ASC
        LIMIT 1;

        RETURN jsonb_build_object(
            'success', true,
            'already_completed', true,
            'status', 'ALREADY_COMPLETED',
            'order', row_to_json(v_order),
            'token', CASE WHEN v_token.token IS NOT NULL THEN row_to_json(v_token) ELSE NULL END
        );
    END IF;

    -- Si ya fue reservada hace menos de 45 segundos, evitar que otra instancia colisione
    IF v_order.captured_at IS NOT NULL AND v_order.captured_at > (NOW() - INTERVAL '45 seconds') THEN
        RETURN jsonb_build_object(
            'success', false,
            'status', 'IN_PROGRESS',
            'error', 'La orden está siendo procesada concurrentemente por otra instancia.'
        );
    END IF;

    -- Marcar la orden como en proceso de captura
    UPDATE public.orders
    SET captured_at = NOW()
    WHERE order_id = p_order_id
    RETURNING * INTO v_order;

    RETURN jsonb_build_object(
        'success', true,
        'status', 'CLAIMED',
        'order', row_to_json(v_order)
    );
END;
$$;

-- ==============================================================================
-- 9. CONFIGURACIÓN DE STORAGE BUCKETS EN SUPABASE
-- ==============================================================================

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
DROP POLICY IF EXISTS "Service role full access on audio masters" ON storage.objects;
CREATE POLICY "Service role full access on audio masters"
    ON storage.objects
    FOR ALL
    USING (bucket_id = 'anomaly-audio-masters' AND (auth.jwt() ->> 'role' = 'service_role' OR current_user = 'postgres'))
    WITH CHECK (bucket_id = 'anomaly-audio-masters' AND (auth.jwt() ->> 'role' = 'service_role' OR current_user = 'postgres'));
