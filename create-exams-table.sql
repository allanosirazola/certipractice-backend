-- create-exams-table.sql - Crear tabla de exámenes

-- Crear tabla de exámenes
CREATE TABLE IF NOT EXISTS exams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL, -- Por ahora sin FK hasta implementar tabla users
    title VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    provider VARCHAR(50) NOT NULL,
    certification VARCHAR(50) NOT NULL,
    questions JSONB NOT NULL DEFAULT '[]', -- Array de preguntas con sus datos
    answers JSONB DEFAULT '{}', -- Respuestas del usuario {questionId: answer}
    time_limit INTEGER DEFAULT 60, -- Tiempo límite en minutos
    time_spent INTEGER DEFAULT 0, -- Tiempo gastado en minutos
    status VARCHAR(20) DEFAULT 'not_started', -- not_started, in_progress, completed
    score INTEGER DEFAULT 0, -- Puntuación en porcentaje
    passed BOOLEAN DEFAULT false, -- Si aprobó o no
    passing_score INTEGER DEFAULT 70, -- Puntuación mínima para aprobar
    started_at TIMESTAMP NULL, -- Cuando empezó el examen
    completed_at TIMESTAMP NULL, -- Cuando terminó el examen
    settings JSONB DEFAULT '{}', -- Configuraciones del examen
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Crear índices para mejorar rendimiento
CREATE INDEX IF NOT EXISTS idx_exams_user_id ON exams(user_id);
CREATE INDEX IF NOT EXISTS idx_exams_status ON exams(status);
CREATE INDEX IF NOT EXISTS idx_exams_provider ON exams(provider);
CREATE INDEX IF NOT EXISTS idx_exams_certification ON exams(certification);
CREATE INDEX IF NOT EXISTS idx_exams_created_at ON exams(created_at);

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_exams_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_exams_updated_at
    BEFORE UPDATE ON exams
    FOR EACH ROW
    EXECUTE FUNCTION update_exams_updated_at();

-- Comentarios para documentación
COMMENT ON TABLE exams IS 'Tabla de exámenes de certificación';
COMMENT ON COLUMN exams.questions IS 'Array JSON con las preguntas del examen y sus opciones';
COMMENT ON COLUMN exams.answers IS 'Objeto JSON con las respuestas del usuario {questionId: respuesta}';
COMMENT ON COLUMN exams.settings IS 'Configuraciones del examen (randomizar, mostrar explicaciones, etc.)';

-- Verificar que se creó correctamente
SELECT 
    table_name, 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'exams' 
ORDER BY ordinal_position;