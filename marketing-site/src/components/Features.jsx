import React from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Code2, Shield, Zap, GitBranch, Terminal } from 'lucide-react';
import styles from './Features.module.css';

const features = [
  {
    icon: <RefreshCw size={28} />,
    title: 'Auto-Sync Magic',
    description: 'Solve a problem, submit, and watch it instantly appear in your GitHub repo. Zero manual work required.'
  },
  {
    icon: <GitBranch size={28} />,
    title: 'Organized Commits',
    description: 'Neatly organized folders with clear commit messages. Keep your green squares popping and recruiters happy.'
  },
  {
    icon: <Code2 size={28} />,
    title: 'Multi-Language Support',
    description: 'Whether you write in Python, C++, Java, or Rust. We capture your syntax perfectly every time.'
  },
  {
    icon: <Zap size={28} />,
    title: 'Lightning Fast',
    description: 'Built with performance in mind. Negligible impact on your browser speed while you grind LeetCode.'
  },
  {
    icon: <Shield size={28} />,
    title: 'Secure by Design',
    description: 'We use standard GitHub OAuth. Your tokens are stored securely in your browser and never sent to our servers.'
  },
  {
    icon: <Terminal size={28} />,
    title: 'Detailed Notes',
    description: 'Automatically captures the problem description, difficulty, and your runtime statistics in a beautiful README.'
  }
];

export default function Features() {
  return (
    <section className={styles.featuresSection}>
      <div className={styles.header}>
        <motion.h2 
          className={styles.title}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          Everything you need.<br/>
          <span className="text-gradient">Nothing you don't.</span>
        </motion.h2>
      </div>

      <div className={styles.grid}>
        {features.map((feature, index) => (
          <motion.div
            key={index}
            className={styles.card}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: index * 0.1 }}
          >
            <div className={styles.iconWrapper}>
              {feature.icon}
            </div>
            <h3 className={styles.cardTitle}>{feature.title}</h3>
            <p className={styles.cardDescription}>{feature.description}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
