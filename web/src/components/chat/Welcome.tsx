export default function Welcome({ onStart }: { onStart?: () => void }) {
  return (
    <section className="chat-welcome">
      <span className="welcome-orb" aria-hidden="true" />
      {onStart ? (
        <button className="primary-button" onClick={onStart}>New conversation <span aria-hidden="true">↗</span></button>
      ) : <p>What’s on your mind?</p>}
    </section>
  );
}
