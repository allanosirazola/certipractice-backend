# Migración de SQL Hardcodeado a Prisma

## Resumen

Este documento explica cómo migrar de queries SQL hardcodeadas a Prisma ORM.

## Estructura de Archivos

```
src/
├── lib/
│   └── prisma.js          # Cliente Prisma singleton
├── repositories/
│   ├── index.js           # Exportación central
│   ├── userRepository.js  # Operaciones de usuarios
│   ├── questionRepository.js  # Operaciones de preguntas
│   └── examRepository.js  # Operaciones de exámenes
└── prisma/
    └── schema.prisma      # Schema de la base de datos
```

## Comparación: Antes vs Después

### Ejemplo 1: Buscar usuario por email

**ANTES (SQL hardcodeado):**
```javascript
const result = await pool.query(
  `SELECT id, username, email, password_hash, first_name, last_name, 
          role, is_active, is_validated, created_at
   FROM users 
   WHERE LOWER(email) = LOWER($1) AND is_active = true`,
  [email]
);
const user = result.rows[0];
```

**DESPUÉS (Prisma):**
```javascript
const { userRepository } = require('./repositories');

const user = await userRepository.findByEmail(email, true);
```

### Ejemplo 2: Crear un examen con preguntas

**ANTES (SQL hardcodeado):**
```javascript
const client = await pool.connect();
try {
  await client.query('BEGIN');
  
  const examResult = await client.query(
    `INSERT INTO exams (user_id, certification_id, title, time_limit, passing_score, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     RETURNING *`,
    [userId, certificationId, title, timeLimit, passingScore]
  );
  
  for (let i = 0; i < questionIds.length; i++) {
    await client.query(
      `INSERT INTO exam_answers (exam_id, question_id, order_index)
       VALUES ($1, $2, $3)`,
      [examResult.rows[0].id, questionIds[i], i]
    );
  }
  
  await client.query('COMMIT');
  return examResult.rows[0];
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

**DESPUÉS (Prisma):**
```javascript
const { examRepository } = require('./repositories');

const exam = await examRepository.create({
  userId,
  certificationId,
  title,
  timeLimit,
  passingScore,
}, questionIds);
```

### Ejemplo 3: Obtener preguntas con filtros y paginación

**ANTES (SQL hardcodeado):**
```javascript
let query = `
  SELECT q.*, t.name as topic_name, c.name as cert_name, p.name as provider_name
  FROM questions q
  JOIN topics t ON q.topic_id = t.id
  JOIN certifications c ON t.certification_id = c.id
  JOIN providers p ON c.provider_id = p.id
  WHERE q.is_active = true
`;
const params = [];
let paramIndex = 1;

if (filters.difficulty) {
  query += ` AND q.difficulty = $${paramIndex++}`;
  params.push(filters.difficulty);
}
if (filters.certificationId) {
  query += ` AND c.id = $${paramIndex++}`;
  params.push(filters.certificationId);
}

query += ` ORDER BY q.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
params.push(limit, offset);

const result = await pool.query(query, params);
```

**DESPUÉS (Prisma):**
```javascript
const { questionRepository } = require('./repositories');

const { questions, total, totalPages } = await questionRepository.findAll({
  page: 1,
  limit: 20,
  difficulty: 'medium',
  certificationId: 5,
  sortBy: 'createdAt',
  sortOrder: 'desc',
});
```

## Pasos de Migración

### 1. Configurar Prisma

```bash
# Instalar dependencias
npm install prisma @prisma/client

# Generar cliente desde schema existente
npx prisma generate

# O introspeccionar BD existente
npx prisma db pull
```

### 2. Configurar variables de entorno

Añadir a `.env`:
```env
DATABASE_URL="postgresql://user:password@localhost:5432/certification_db?schema=public"
```

### 3. Migrar servicios gradualmente

1. **Empezar con operaciones simples** (findById, findByEmail)
2. **Luego operaciones de escritura** (create, update, delete)
3. **Finalmente operaciones complejas** (joins, transacciones)

### 4. Actualizar los servicios existentes

```javascript
// services/userService.js - ANTES
const pool = require('../utils/pool');

async findByEmail(email) {
  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  return result.rows[0];
}

// services/userService.js - DESPUÉS
const { userRepository } = require('../repositories');

async findByEmail(email) {
  return userRepository.findByEmail(email);
}
```

## Ventajas de Prisma

| Aspecto | SQL Hardcodeado | Prisma |
|---------|-----------------|--------|
| Type Safety | ❌ No | ✅ Sí |
| Autocompletado | ❌ No | ✅ Sí |
| Migraciones | Manual | Automáticas |
| Relaciones | JOINs manuales | Automáticas |
| Transacciones | Try/catch manual | `$transaction` |
| SQL Injection | Riesgo si no paramtetrizado | Protegido |
| Mantenimiento | Difícil | Fácil |
| Testing | Mock complejo | Mock simple |

## Comandos Útiles de Prisma

```bash
# Generar cliente después de cambios en schema
npx prisma generate

# Crear migración
npx prisma migrate dev --name nombre_migracion

# Aplicar migraciones en producción
npx prisma migrate deploy

# Abrir Prisma Studio (GUI)
npx prisma studio

# Introspeccionar BD existente
npx prisma db pull

# Formatear schema
npx prisma format

# Validar schema
npx prisma validate
```

## Testing con Prisma

```javascript
// tests/mocks/prisma.js
const { mockDeep, mockReset } = require('jest-mock-extended');
const prisma = require('../../src/lib/prisma');

jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: mockDeep(),
}));

beforeEach(() => {
  mockReset(prisma);
});

// En el test
prisma.user.findUnique.mockResolvedValue({
  id: 1,
  email: 'test@example.com',
  username: 'testuser',
});

const user = await userRepository.findById(1);
expect(user.email).toBe('test@example.com');
```

## Próximos Pasos

1. ✅ Schema de Prisma creado
2. ✅ Repositorios implementados
3. ⏳ Actualizar servicios para usar repositorios
4. ⏳ Actualizar tests
5. ⏳ Probar con base de datos real
6. ⏳ Crear migraciones

## Notas Importantes

- **No eliminar código SQL inmediatamente**: Mantener ambos sistemas durante la transición
- **Probar exhaustivamente**: Cada migración debe tener tests
- **Migrar en partes**: Un servicio a la vez
- **Monitorear rendimiento**: Prisma genera queries optimizadas pero verificar
