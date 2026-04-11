<template>
  <canvas ref="canvasRef" class="absolute inset-0 h-full w-full opacity-40 pointer-events-none"></canvas>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import gsap from "gsap";

const canvasRef = ref<HTMLCanvasElement | null>(null);
let cleanup: (() => void) | null = null;

onMounted(() => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const resize = () => {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  };

  resize();
  window.addEventListener("resize", resize);

  const dots = Array.from({ length: 30 }).map(() => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    r: 1 + Math.random() * 2.5,
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.3,
  }));

  const render = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(212, 168, 67, 0.35)";
    dots.forEach((dot) => {
      dot.x += dot.vx;
      dot.y += dot.vy;
      if (dot.x < 0 || dot.x > canvas.width) dot.vx *= -1;
      if (dot.y < 0 || dot.y > canvas.height) dot.vy *= -1;
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
      ctx.fill();
    });
  };

  gsap.ticker.add(render);

  cleanup = () => {
    window.removeEventListener("resize", resize);
    gsap.ticker.remove(render);
  };
});

onUnmounted(() => {
  cleanup?.();
});
</script>
