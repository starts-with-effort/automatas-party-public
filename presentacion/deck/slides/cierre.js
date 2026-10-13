// 19 · Cierre: tres ideas, preguntas y (opcional) el QR para entrar al quiz.
import { box, hidden, s, show } from './common.js';

export default function mount({ body, steps }) {
  box(body, 'ideas', { x: 0, y: 0, w: 1728 }, `
    <div class="card idea-card"><b>1</b><p>Un PDA es un <strong>AFN-ε con una pila</strong>:<br>P = (Q, Σ, Γ, δ, ${s('q0')}, ${s('Z0')}, F).</p></div>
    <div class="card idea-card"><b>2</b><p>Se ejecuta con <strong>descripciones instantáneas</strong> (q, w, γ) y ⊢. Con no determinismo, <strong>basta una rama</strong> que acepte.</p></div>
    <div class="card idea-card"><b>3</b><p>Aceptar <strong>por estado final</strong> o <strong>por pila vacía</strong> da el mismo poder.</p></div>`);
  const questions = box(body, 'questions display-font', { x: 0, y: 440, w: 1728 }, '¿Preguntas?');
  const quiz = box(body, 'card quiz', { x: 1100, y: 380, w: 628 }, `
    <img src="/api/join-qr.svg" alt="QR del quiz" width="250" height="250">
    <div><div class="display-font big">Ahora: taller y quiz</div><div class="muted quiz-url"></div></div>`);
  fetch('/api/info').then((res) => res.json()).then((info) => {
    quiz.querySelector('.quiz-url').textContent = info.joinUrl.replace(/^https?:\/\//, '');
  }).catch(() => {});
  hidden([questions, quiz]);

  steps.step((tl, at) => show(tl, at, questions, { ease: 'back.out(1.6)' }));
  steps.step((tl, at) => {
    tl.to(questions, { x: -300, scale: 0.8, duration: 0.4 }, at);
    show(tl, at + 0.1, quiz);
  });
}
