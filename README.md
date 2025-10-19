# Certification Practice Backend

Backend API para plataforma de práctica de certificaciones de cloud computing (AWS, GCP, Azure).

## 🚀 Características

- **API REST completa** con autenticación JWT
- **Gestión de usuarios** con roles y estadísticas
- **Sistema de preguntas** con categorías, dificultades y filtros
- **Exámenes personalizables** con tiempo límite y resultados detallados
- **Estadísticas globales** y por usuario
- **Rate limiting** y medidas de seguridad
- **Logging completo** con Winston
- **Tests automatizados** con Jest
- **Arquitectura escalable** con servicios y controladores separados

## 📋 Requisitos

- Node.js >= 16.0.0
- npm >= 8.0.0

## 🛠️ Instalación

```bash
# Clonar o crear el proyecto
git clone <tu-repo>
cd certification-practice-backend

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Edita el archivo .env con tus configuraciones

# Ejecutar en modo desarrollo
npm run dev

# Ejecutar en producción
npm start
```

## 🔧 Variables de Entorno

```env
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRE=7d
BCRYPT_ROUNDS=12
LOG_LEVEL=info
```

## 📚 API Endpoints

### Autenticación
- `POST /api/auth/register` - Registrar usuario
- `POST /api/auth/login` - Iniciar sesión
- `GET /api/auth/profile` - Obtener perfil (requiere auth)
- `PUT /api/auth/profile` - Actualizar perfil (requiere auth)

### Preguntas
- `GET /api/questions` - Listar preguntas con filtros
- `GET /api/questions/:id` - Obtener pregunta específica
- `POST /api/questions` - Crear pregunta (admin)
- `PUT /api/questions/:id` - Actualizar pregunta (admin)
- `DELETE /api/questions/:id` - Eliminar pregunta (admin)
- `GET /api/questions/categories` - Obtener categorías
- `GET /api/questions/providers` - Obtener proveedores
- `GET /api/questions/certifications` - Obtener certificaciones

### Exámenes
- `POST /api/exams` - Crear examen
- `GET /api/exams` - Listar exámenes del usuario
- `GET /api/exams/:id` - Obtener examen específico
- `POST /api/exams/:id/start` - Iniciar examen
- `POST /api/exams/:id/answer` - Enviar respuesta
- `POST /api/exams/:id/complete` - Completar examen
- `GET /api/exams/:id/results` - Obtener resultados
- `DELETE /api/exams/:id` - Eliminar examen

### Usuarios
- `GET /api/users/stats` - Estadísticas del usuario
- `PUT /api/users/preferences` - Actualizar preferencias

### Estadísticas
- `GET /api/stats/global` - Estadísticas globales
- `GET /api/stats/questions` - Estadísticas de preguntas (admin)

## 🏗️ Arquitectura

```
src/
├── app.js              # Configuración de Express
├── server.js           # Servidor principal
├── config/             # Configuraciones
├── controllers/        # Controladores de rutas
├── middleware/         # Middleware personalizado
├── models/             # Modelos de datos
├── routes/             # Definición de rutas
├── services/           # Lógica de negocio
├── utils/              # Utilidades
└── tests/              # Tests automatizados
```

## 🗄️ Estructura de Datos

El sistema usa archivos JSON para persistencia (fácil migración a base de datos):

- **Usuarios**: `data/users/users.json`
- **Preguntas**: `data/questions/questions.json`
- **Exámenes**: `data/exams/exams.json`

## 🧪 Testing

```bash
# Ejecutar todos los tests
npm test

# Ejecutar tests en modo watch
npm run test:watch

# Generar reporte de coverage
npm test -- --coverage
```

## 🔍 Linting y Formatting

```bash
# Verificar código
npm run lint

# Corregir errores automáticamente
npm run lint:fix

# Formatear código
npm run format
```

## 🚀 Despliegue

### Desarrollo
```bash
npm run dev
```

### Producción
```bash
npm start
```

## 📝 Ejemplos de Uso

### Registrar Usuario
```javascript
const response = await fetch('/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: 'usuario',
    email: 'usuario@email.com',
    password: 'password123',
    firstName: 'Nombre',
    lastName: 'Apellido'
  })
});
```

### Crear Examen
```javascript
const response = await fetch('/api/exams', {
  method: 'POST',
  headers: { 
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    title: 'Examen AWS SAA-C03',
    provider: 'AWS',
    certification: 'SAA-C03',
    questionCount: 20,
    timeLimit: 60
  })
});
```

## 🔐 Seguridad

- **Autenticación JWT** con expiración configurable
- **Bcrypt** para hash de contraseñas
- **Helmet** para headers de seguridad
- **Rate limiting** para prevenir ataques
- **CORS** configurado
- **Validación de entrada** en todos los endpoints

## 📊 Monitoreo

- **Logging estructurado** con Winston
- **Health check** endpoint: `GET /health`
- **Métricas de rendimiento** en logs
- **Error tracking** completo

## 🤝 Contribuir

1. Fork el proyecto
2. Crea tu feature branch (`git checkout -b feature/nueva-funcionalidad`)
3. Commit tus cambios (`git commit -am 'Añadir nueva funcionalidad'`)
4. Push al branch (`git push origin feature/nueva-funcionalidad`)
5. Abre un Pull Request

## 📄 Licencia

MIT License - ver archivo LICENSE para detalles.

## 🆘 Soporte

Para reportar bugs o solicitar características, abre un issue en el repositorio.
