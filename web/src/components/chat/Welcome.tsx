export default function Welcome({ onStart }: { onStart?: () => void }) {
  return (
    <section className="chat-welcome">
      <svg className="welcome-chat-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 8h24a5 5 0 0 1 5 5v18a5 5 0 0 1-5 5H20l-10 7v-7a5 5 0 0 1-3-5V13a5 5 0 0 1 5-5Z" />
        <path d="M16 19h16M16 25h10" />
      </svg>
      {onStart ? (
        <button className="primary-button" onClick={onStart}>New conversation <span aria-hidden="true">↗</span></button>
      ) : <p>What’s on your mind?</p>}
    </section>
  );
}
