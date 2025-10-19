// update-system.js - Script para actualizar todo el sistema
require('dotenv').config();
const { Pool } = require('pg');
const axios = require('axios');

class SystemUpdater {
  constructor() {
    this.pool = new Pool({
      user: process.env.DB_USER || 'postgres',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'certification_db',
      password: process.env.DB_PASSWORD || 'certification123',
      port: process.env.DB_PORT || 5432,
    });
  }

  async updateDatabase() {
    console.log('🗄️  Actualizando estructura de base de datos...');
    
    const client = await this.pool.connect();
    
    try {
      // Crear tabla exams si no existe
      await client.query(`
        CREATE TABLE IF NOT EXISTS exams (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id VARCHAR(255) NOT NULL,
            title VARCHAR(255) NOT NULL,
            description TEXT DEFAULT '',
            provider VARCHAR(50) NOT NULL,
            certification VARCHAR(50) NOT NULL,
            questions JSONB NOT NULL DEFAULT '[]',
            answers JSONB DEFAULT '{}',
            time_limit INTEGER DEFAULT 60,
            time_spent INTEGER DEFAULT 0,
            status VARCHAR(20) DEFAULT 'not_started',
            score INTEGER DEFAULT 0,
            passed BOOLEAN DEFAULT false,
            passing_score INTEGER DEFAULT 70,
            started_at TIMESTAMP NULL,
            completed_at TIMESTAMP NULL,
            settings JSONB DEFAULT '{}',
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
      `);

      // Crear índices
      const indexes = [
        'CREATE INDEX IF NOT EXISTS idx_exams_user_id ON exams(user_id);',
        'CREATE INDEX IF NOT EXISTS idx_exams_status ON exams(status);',
        'CREATE INDEX IF NOT EXISTS idx_exams_provider ON exams(provider);',
        'CREATE INDEX IF NOT EXISTS idx_exams_certification ON exams(certification);'
      ];

      for (const index of indexes) {
        await client.query(index);
      }

      console.log('✅ Base de datos actualizada');
      
    } catch (error) {
      console.error('❌ Error actualizando base de datos:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async testBackendConnection() {
    console.log('🔌 Probando conexión del backend...');
    
    try {
      // Probar health check
      const healthResponse = await axios.get('http://localhost:3000/health');
      console.log('✅ Backend health check: OK');

      // Probar obtener proveedores
      const providersResponse = await axios.get('http://localhost:3000/api/questions/providers');
      const providers = providersResponse.data.data;
      console.log(`✅ Proveedores encontrados: ${providers.join(', ')}`);

      // Probar obtener preguntas
      const questionsResponse = await axios.get('http://localhost:3000/api/questions?limit=5');
      const questions = questionsResponse.data.data.questions;
      console.log(`✅ Preguntas encontradas: ${questions.length}`);

      return { success: true, providers, questionCount: questions.length };

    } catch (error) {
      console.error('❌ Error conectando con backend:', error.message);
      return { success: false, error: error.message };
    }
  }

  async testFrontendConnection() {
    console.log('🌐 Probando conexión del frontend...');
    
    try {
      const response = await axios.get('http://localhost:5173');
      console.log('✅ Frontend accesible');
      return { success: true };
    } catch (error) {
      console.error('❌ Frontend no accesible:', error.message);
      return { success: false, error: error.message };
    }
  }

  async checkSystemStatus() {
    console.log('🔍 Verificando estado del sistema completo...\n');

    const results = {
      database: false,
      backend: false,
      frontend: false,
      integration: false
    };

    try {
      // 1. Probar PostgreSQL
      console.log('1️⃣  Verificando PostgreSQL...');
      const client = await this.pool.connect();
      const dbResult = await client.query('SELECT COUNT(*) FROM questions');
      const questionCount = parseInt(dbResult.rows[0].count);
      console.log(`   📊 Preguntas en DB: ${questionCount}`);
      client.release();
      results.database = true;

      // 2. Probar Backend
      console.log('\n2️⃣  Verificando Backend...');
      const backendTest = await this.testBackendConnection();
      results.backend = backendTest.success;
      
      if (backendTest.success) {
        console.log(`   📊 Proveedores: ${backendTest.providers.length}`);
        console.log(`   📊 Preguntas API: ${backendTest.questionCount}`);
      }

      // 3. Probar Frontend
      console.log('\n3️⃣  Verificando Frontend...');
      const frontendTest = await this.testFrontendConnection();
      results.frontend = frontendTest.success;

      // 4. Probar integración completa
      console.log('\n4️⃣  Verificando integración...');
      if (results.database && results.backend) {
        // Probar crear un examen de prueba (requiere usuario, así que solo verificamos endpoint)
        try {
          await axios.post('http://localhost:3000/api/exams', {
            title: 'Test',
            provider: 'AWS',
            certification: 'SAA-C03'
          });
        } catch (error) {
          if (error.response?.status === 401) {
            console.log('   ✅ Endpoint de exámenes funciona (requiere auth)');
            results.integration = true;
          }
        }
      }

    } catch (error) {
      console.error('❌ Error en verificación:', error.message);
    }

    // Resumen
    console.log('\n' + '='.repeat(50));
    console.log('📊 ESTADO DEL SISTEMA');
    console.log('='.repeat(50));
    console.log(`🗄️  PostgreSQL: ${results.database ? '✅ OK' : '❌ ERROR'}`);
    console.log(`🔌 Backend API: ${results.backend ? '✅ OK' : '❌ ERROR'}`);
    console.log(`🌐 Frontend: ${results.frontend ? '✅ OK' : '❌ ERROR'}`);
    console.log(`🔗 Integración: ${results.integration ? '✅ OK' : '❌ ERROR'}`);

    const allWorking = Object.values(results).every(r => r);
    
    if (allWorking) {
      console.log('\n🎉 ¡SISTEMA COMPLETAMENTE FUNCIONAL!');
      console.log('🌐 Frontend: http://localhost:5173');
      console.log('🔌 Backend: http://localhost:3000');
      console.log('🗄️  PostgreSQL: puerto 5432');
    } else {
      console.log('\n⚠️  Algunos componentes necesitan atención');
      
      if (!results.database) console.log('   • Verificar PostgreSQL y migración de datos');
      if (!results.backend) console.log('   • Verificar que el backend esté corriendo');
      if (!results.frontend) console.log('   • Verificar que el frontend esté corriendo');
      if (!results.integration) console.log('   • Verificar integración entre componentes');
    }

    return results;
  }

  async close() {
    await this.pool.end();
  }
}

// Ejecutar si se llama directamente
async function main() {
  const updater = new SystemUpdater();
  
  try {
    await updater.updateDatabase();
    console.log('');
    await updater.checkSystemStatus();
  } catch (error) {
    console.error('❌ Error fatal:', error);
  } finally {
    await updater.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = SystemUpdater;