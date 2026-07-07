import React from 'react';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import styles from './CTA.module.css';

export default function CTA() {
  return (
    <section className={styles.ctaSection}>
      <motion.div 
        className={styles.container}
        initial={{ opacity: 0, scale: 0.95 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
      >
        <div className={styles.glow1} />
        <div className={styles.glow2} />
        
        <h2 className={styles.title}>Ready to level up your GitHub profile?</h2>
        <p className={styles.description}>
          Join thousands of developers who are already showcasing their algorithmic skills with LeetSync.
        </p>
        
        <div className={styles.buttonWrapper}>
          <button className={styles.ctaBtn}>
            Install Extension Free
            <ArrowRight size={24} />
          </button>
        </div>
      </motion.div>
    </section>
  );
}
