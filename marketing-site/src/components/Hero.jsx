import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Sphere, MeshDistortMaterial, Float } from '@react-three/drei';
import { motion } from 'framer-motion';
import { Download } from 'lucide-react';
import styles from './Hero.module.css';

const AnimatedSphere = () => {
  return (
    <Float speed={2} rotationIntensity={2} floatIntensity={2}>
      <Sphere args={[1, 100, 200]} scale={2.2}>
        <MeshDistortMaterial
          color="#7000ff"
          attach="material"
          distort={0.4}
          speed={2}
          roughness={0.2}
          metalness={0.8}
        />
      </Sphere>
      {/* Secondary accent sphere inside */}
      <Sphere args={[1, 100, 200]} scale={1.8}>
        <MeshDistortMaterial
          color="#00f0ff"
          attach="material"
          distort={0.6}
          speed={3}
          roughness={0.1}
          metalness={0.9}
          wireframe
        />
      </Sphere>
    </Float>
  );
};

export default function Hero() {
  return (
    <section className={styles.heroSection}>
      <div className={styles.content}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <span className={styles.badge}>LeetCode to GitHub</span>
          <h1 className={styles.title}>
            Sync Your Code <br />
            <span className="text-gradient">Automatically</span>
          </h1>
          <p className={styles.description}>
            The most elegant way to track your LeetCode progress. Push your solutions directly to GitHub with a single click. Completely effortless.
          </p>
          <div className={styles.actions}>
            <button className={styles.primaryBtn}>
              <Download size={20} />
              Add to Chrome
            </button>
            <button className={styles.secondaryBtn}>View on GitHub</button>
          </div>
        </motion.div>
      </div>
      
      <div className={styles.canvasContainer}>
        <Canvas camera={{ position: [0, 0, 5], fov: 45 }}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[10, 10, 5]} intensity={1} />
          <directionalLight position={[-10, -10, -5]} intensity={0.5} color="#00f0ff" />
          <AnimatedSphere />
          <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={1} />
        </Canvas>
      </div>
    </section>
  );
}
