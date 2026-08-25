import tkinter as tk
import cv2
import threading
import matplotlib
matplotlib.use("Agg")  # Use non-interactive backend to avoid GIL issues
import matplotlib.pyplot as plt
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from PIL import Image, ImageTk
import socket
import requests
import pygame
import geocoder

from orange_detector import OrangeDetector
from kalmanfilter import KalmanFilter


# ─────────────────────────────────────────────
# VIDEO + ML SETUP
# ─────────────────────────────────────────────

cap = cv2.VideoCapture("ball.mp4")

od = OrangeDetector()
kf = KalmanFilter()

pygame.mixer.init()
pygame.mixer.music.load("siren.mpeg")

prev_y   = None
siren_on = False

x_data_initial = []
y_data_initial = []
x_data_pred    = []
y_data_pred    = []

# ─────────────────────────────────────────────
# PERFORMANCE COUNTERS
# ─────────────────────────────────────────────

DISPLAY_W  = 640   # resize video for faster PIL conversion
DISPLAY_H  = 480
GRAPH_EVERY = 8    # redraw matplotlib only every N frames
frame_count = 0

# ─────────────────────────────────────────────
# ROOT WINDOW
# ─────────────────────────────────────────────

root = tk.Tk()
root.title("Sentinel Shield Defense Dashboard")
root.geometry("1600x900")
root.configure(bg="#0b132b")

title = tk.Label(
    root,
    text="Sentinel Shield Defense Monitoring System",
    font=("Arial", 26, "bold"),
    fg="#00ffe1",
    bg="#0b132b",
)
title.pack(pady=10)

main = tk.Frame(root, bg="#0b132b")
main.pack(fill="both", expand=True)
main.rowconfigure((0, 1), weight=1)
main.columnconfigure((0, 1), weight=1)


# ─────────────────────────────────────────────
# FRAME 1 – VIDEO
# ─────────────────────────────────────────────

video_frame = tk.Frame(main, bg="#1c2541", bd=3, relief="ridge")
video_frame.grid(row=0, column=0, sticky="nsew", padx=10, pady=10)

video_label = tk.Label(video_frame)
video_label.pack(expand=True)


# ─────────────────────────────────────────────
# FRAME 2 – TRAJECTORY GRAPH
# ─────────────────────────────────────────────

graph_frame = tk.Frame(main, bg="#1c2541", bd=3, relief="ridge")
graph_frame.grid(row=0, column=1, sticky="nsew", padx=10, pady=10)

fig, ax = plt.subplots(figsize=(5, 4))
fig.patch.set_facecolor("#1c2541")
ax.set_facecolor("#0b132b")
ax.tick_params(colors="white")
ax.set_title("Trajectory", color="white")

line_initial, = ax.plot([], [], color="blue", marker="o", markersize=3, label="Initial")
line_pred,    = ax.plot([], [], color="red",  marker="o", markersize=3, label="Predicted")
ax.set_xlim(0, DISPLAY_W)
ax.set_ylim(0, DISPLAY_H)
ax.legend(facecolor="#1c2541", labelcolor="white")

canvas_graph = FigureCanvasTkAgg(fig, master=graph_frame)
canvas_graph.get_tk_widget().pack(expand=True)


# ─────────────────────────────────────────────
# FRAME 3 – RADAR
# ─────────────────────────────────────────────

radar_frame = tk.Frame(main, bg="#1c2541", bd=3, relief="ridge")
radar_frame.grid(row=1, column=0, sticky="nsew", padx=10, pady=10)

radar = tk.Canvas(radar_frame, width=400, height=400, bg="black")
radar.pack(expand=True)


# ─────────────────────────────────────────────
# FRAME 4 – INFO PANEL
# ─────────────────────────────────────────────

info_frame = tk.Frame(main, bg="#1c2541", bd=3, relief="ridge")
info_frame.grid(row=1, column=1, sticky="nsew", padx=10, pady=10)

coord_label = tk.Label(
    info_frame,
    text="Object Location: —",
    font=("Arial", 14),
    fg="white",
    bg="#1c2541",
)
coord_label.pack(pady=10)

status_label = tk.Label(
    info_frame,
    text="STATUS : SAFE",
    font=("Arial", 16, "bold"),
    fg="lime",
    bg="#1c2541",
)
status_label.pack(pady=10)


def get_ip():
    hostname = socket.gethostname()
    return socket.gethostbyname(hostname)

ip_label = tk.Label(info_frame, text="IP : " + get_ip(), fg="cyan", bg="#1c2541")
ip_label.pack()


def get_location():
    try:
        g = geocoder.ip("me")
        return str(g.latlng)
    except Exception:
        return "Unknown"

location_label = tk.Label(
    info_frame,
    text="Attack Location: " + get_location(),
    fg="yellow",
    bg="#1c2541",
)
location_label.pack(pady=10)


# ─────────────────────────────────────────────
# NON-BLOCKING ALERT  ← KEY FIX #1
# Network I/O now runs in a daemon thread so it
# never stalls the video loop.
# ─────────────────────────────────────────────

def send_alert():
    """Fire-and-forget POST — runs in background thread."""
    def _post():
        try:
            requests.post(
                "https://sentinel-shield-m-indicator-hacks.onrender.com/danger",
                timeout=5,
            )
        except Exception:
            pass
    threading.Thread(target=_post, daemon=True).start()


def manual_alert():
    pygame.mixer.music.play(-1)
    send_alert()
    status_label.config(text="MANUAL ALERT", fg="red")


alert_btn = tk.Button(
    info_frame,
    text="MANUAL ALERT",
    bg="red",
    fg="white",
    font=("Arial", 14, "bold"),
    command=manual_alert,
)
alert_btn.pack(pady=20)


# ─────────────────────────────────────────────
# RADAR DRAW
# ─────────────────────────────────────────────

def draw_radar(x, y):
    radar.delete("all")
    cx, cy = 200, 200
    for r in range(50, 200, 50):
        radar.create_oval(cx - r, cy - r, cx + r, cy + r, outline="green")
    radar.create_line(0, 200, 400, 200, fill="green")
    radar.create_line(200, 0, 200, 400, fill="green")
    rx = int(x / DISPLAY_W * 400)
    ry = int(y / DISPLAY_H * 400)
    radar.create_oval(rx - 5, ry - 5, rx + 5, ry + 5, fill="red")


# ─────────────────────────────────────────────
# MAIN UPDATE LOOP
# ─────────────────────────────────────────────

def update():
    global prev_y, siren_on, frame_count

    ret, frame = cap.read()
    if not ret:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        root.after(16, update)   # ~60 fps attempt on empty read
        return

    # ── KEY FIX #2: resize early so every subsequent op is cheaper ──
    frame = cv2.resize(frame, (DISPLAY_W, DISPLAY_H))

    bbox = od.detect(frame)

    if bbox is None:
        # Still display the frame even when nothing is detected
        _show_frame(frame)
        root.after(16, update)
        return

    x, y, x2, y2 = bbox
    cx = int((x + x2) / 2)
    cy = int((y + y2) / 2)

    pred = kf.predict(cx, cy)
    px, py = int(pred[0]), int(pred[1])

    # Draw overlays on frame
    cv2.rectangle(frame, (x, y), (x2, y2), (0, 255, 0), 2)
    cv2.circle(frame, (cx, cy), 6, (255, 0, 0), -1)    # blue  = detected
    cv2.circle(frame, (px, py), 6, (0, 0, 255), -1)    # red   = predicted

    # ── Siren / status logic ──
    if prev_y is not None:
        if cy > prev_y and not siren_on:
            pygame.mixer.music.play(-1)
            siren_on = True
            send_alert()  # non-blocking now
            status_label.config(text="STATUS : DANGER", fg="red")
        elif cy < prev_y and siren_on:
            pygame.mixer.music.stop()
            siren_on = False
            status_label.config(text="STATUS : SAFE", fg="lime")
    prev_y = cy

    # ── Append trajectory data ──
    x_data_initial.append(cx)
    y_data_initial.append(cy)
    x_data_pred.append(px)
    y_data_pred.append(py)

    # ── KEY FIX #3: update matplotlib only every GRAPH_EVERY frames ──
    frame_count += 1
    if frame_count % GRAPH_EVERY == 0:
        line_initial.set_data(x_data_initial, y_data_initial)
        line_pred.set_data(x_data_pred, y_data_pred)
        canvas_graph.draw_idle()

    # ── Info panel & radar ──
    coord_label.config(text=f"Object Location: {cx}, {cy}")
    draw_radar(cx, cy)

    # ── Display video frame ──
    _show_frame(frame)

    root.after(16, update)   # target ~60 fps  (use 33 for ~30 fps)


def _show_frame(frame):
    """Convert a BGR frame to a Tk image and push it to the label.
    Extracted so the no-detection path can also update the video feed."""
    rgb   = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    img   = Image.fromarray(rgb)
    imgtk = ImageTk.PhotoImage(image=img)
    video_label.imgtk = imgtk          # keep reference alive
    video_label.configure(image=imgtk)


# ─────────────────────────────────────────────
# START
# ─────────────────────────────────────────────

root.after(16, update)
root.mainloop()

cap.release()
cv2.destroyAllWindows()import tkinter as tk
import cv2
import threading
import matplotlib
matplotlib.use("Agg")  # Use non-interactive backend to avoid GIL issues
import matplotlib.pyplot as plt
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from PIL import Image, ImageTk
import socket
import requests
import pygame
import geocoder

from orange_detector import OrangeDetector
from kalmanfilter import KalmanFilter


# ─────────────────────────────────────────────
# VIDEO + ML SETUP
# ─────────────────────────────────────────────

cap = cv2.VideoCapture("ball.mp4")

od = OrangeDetector()
kf = KalmanFilter()

pygame.mixer.init()
pygame.mixer.music.load("siren.mpeg")

prev_y   = None
siren_on = False

x_data_initial = []
y_data_initial = []
x_data_pred    = []
y_data_pred    = []

# ─────────────────────────────────────────────
# PERFORMANCE COUNTERS
# ─────────────────────────────────────────────

DISPLAY_W  = 640   # resize video for faster PIL conversion
DISPLAY_H  = 480
GRAPH_EVERY = 8    # redraw matplotlib only every N frames
frame_count = 0

# ─────────────────────────────────────────────
# ROOT WINDOW
# ─────────────────────────────────────────────

root = tk.Tk()
root.title("Sentinel Shield Defense Dashboard")
root.geometry("1600x900")
root.configure(bg="#0b132b")

title = tk.Label(
    root,
    text="Sentinel Shield Defense Monitoring System",
    font=("Arial", 26, "bold"),
    fg="#00ffe1",
    bg="#0b132b",
)
title.pack(pady=10)

main = tk.Frame(root, bg="#0b132b")
main.pack(fill="both", expand=True)
main.rowconfigure((0, 1), weight=1)
main.columnconfigure((0, 1), weight=1)


# ─────────────────────────────────────────────
# FRAME 1 – VIDEO
# ─────────────────────────────────────────────

video_frame = tk.Frame(main, bg="#1c2541", bd=3, relief="ridge")
video_frame.grid(row=0, column=0, sticky="nsew", padx=10, pady=10)

video_label = tk.Label(video_frame)
video_label.pack(expand=True)


# ─────────────────────────────────────────────
# FRAME 2 – TRAJECTORY GRAPH
# ─────────────────────────────────────────────

graph_frame = tk.Frame(main, bg="#1c2541", bd=3, relief="ridge")
graph_frame.grid(row=0, column=1, sticky="nsew", padx=10, pady=10)

fig, ax = plt.subplots(figsize=(5, 4))
fig.patch.set_facecolor("#1c2541")
ax.set_facecolor("#0b132b")
ax.tick_params(colors="white")
ax.set_title("Trajectory", color="white")

line_initial, = ax.plot([], [], color="blue", marker="o", markersize=3, label="Initial")
line_pred,    = ax.plot([], [], color="red",  marker="o", markersize=3, label="Predicted")
ax.set_xlim(0, DISPLAY_W)
ax.set_ylim(0, DISPLAY_H)
ax.legend(facecolor="#1c2541", labelcolor="white")

canvas_graph = FigureCanvasTkAgg(fig, master=graph_frame)
canvas_graph.get_tk_widget().pack(expand=True)


# ─────────────────────────────────────────────
# FRAME 3 – RADAR
# ─────────────────────────────────────────────

radar_frame = tk.Frame(main, bg="#1c2541", bd=3, relief="ridge")
radar_frame.grid(row=1, column=0, sticky="nsew", padx=10, pady=10)

radar = tk.Canvas(radar_frame, width=400, height=400, bg="black")
radar.pack(expand=True)


# ─────────────────────────────────────────────
# FRAME 4 – INFO PANEL
# ─────────────────────────────────────────────

info_frame = tk.Frame(main, bg="#1c2541", bd=3, relief="ridge")
info_frame.grid(row=1, column=1, sticky="nsew", padx=10, pady=10)

coord_label = tk.Label(
    info_frame,
    text="Object Location: —",
    font=("Arial", 14),
    fg="white",
    bg="#1c2541",
)
coord_label.pack(pady=10)

status_label = tk.Label(
    info_frame,
    text="STATUS : SAFE",
    font=("Arial", 16, "bold"),
    fg="lime",
    bg="#1c2541",
)
status_label.pack(pady=10)


def get_ip():
    hostname = socket.gethostname()
    return socket.gethostbyname(hostname)

ip_label = tk.Label(info_frame, text="IP : " + get_ip(), fg="cyan", bg="#1c2541")
ip_label.pack()


def get_location():
    try:
        g = geocoder.ip("me")
        return str(g.latlng)
    except Exception:
        return "Unknown"

location_label = tk.Label(
    info_frame,
    text="Attack Location: " + get_location(),
    fg="yellow",
    bg="#1c2541",
)
location_label.pack(pady=10)


# ─────────────────────────────────────────────
# NON-BLOCKING ALERT  ← KEY FIX #1
# Network I/O now runs in a daemon thread so it
# never stalls the video loop.
# ─────────────────────────────────────────────

def send_alert():
    """Fire-and-forget POST — runs in background thread."""
    def _post():
        try:
            requests.post(
                "https://sentinel-shield-m-indicator-hacks.onrender.com/danger",
                timeout=5,
            )
        except Exception:
            pass
    threading.Thread(target=_post, daemon=True).start()


def manual_alert():
    pygame.mixer.music.play(-1)
    send_alert()
    status_label.config(text="MANUAL ALERT", fg="red")


alert_btn = tk.Button(
    info_frame,
    text="MANUAL ALERT",
    bg="red",
    fg="white",
    font=("Arial", 14, "bold"),
    command=manual_alert,
)
alert_btn.pack(pady=20)


# ─────────────────────────────────────────────
# RADAR DRAW
# ─────────────────────────────────────────────

def draw_radar(x, y):
    radar.delete("all")
    cx, cy = 200, 200
    for r in range(50, 200, 50):
        radar.create_oval(cx - r, cy - r, cx + r, cy + r, outline="green")
    radar.create_line(0, 200, 400, 200, fill="green")
    radar.create_line(200, 0, 200, 400, fill="green")
    rx = int(x / DISPLAY_W * 400)
    ry = int(y / DISPLAY_H * 400)
    radar.create_oval(rx - 5, ry - 5, rx + 5, ry + 5, fill="red")


# ─────────────────────────────────────────────
# MAIN UPDATE LOOP
# ─────────────────────────────────────────────

def update():
    global prev_y, siren_on, frame_count

    ret, frame = cap.read()
    if not ret:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        root.after(16, update)   # ~60 fps attempt on empty read
        return

    # ── KEY FIX #2: resize early so every subsequent op is cheaper ──
    frame = cv2.resize(frame, (DISPLAY_W, DISPLAY_H))

    bbox = od.detect(frame)

    if bbox is None:
        # Still display the frame even when nothing is detected
        _show_frame(frame)
        root.after(16, update)
        return

    x, y, x2, y2 = bbox
    cx = int((x + x2) / 2)
    cy = int((y + y2) / 2)

    pred = kf.predict(cx, cy)
    px, py = int(pred[0]), int(pred[1])

    # Draw overlays on frame
    cv2.rectangle(frame, (x, y), (x2, y2), (0, 255, 0), 2)
    cv2.circle(frame, (cx, cy), 6, (255, 0, 0), -1)    # blue  = detected
    cv2.circle(frame, (px, py), 6, (0, 0, 255), -1)    # red   = predicted

    # ── Siren / status logic ──
    if prev_y is not None:
        if cy > prev_y and not siren_on:
            pygame.mixer.music.play(-1)
            siren_on = True
            send_alert()  # non-blocking now
            status_label.config(text="STATUS : DANGER", fg="red")
        elif cy < prev_y and siren_on:
            pygame.mixer.music.stop()
            siren_on = False
            status_label.config(text="STATUS : SAFE", fg="lime")
    prev_y = cy

    # ── Append trajectory data ──
    x_data_initial.append(cx)
    y_data_initial.append(cy)
    x_data_pred.append(px)
    y_data_pred.append(py)

    # ── KEY FIX #3: update matplotlib only every GRAPH_EVERY frames ──
    frame_count += 1
    if frame_count % GRAPH_EVERY == 0:
        line_initial.set_data(x_data_initial, y_data_initial)
        line_pred.set_data(x_data_pred, y_data_pred)
        canvas_graph.draw_idle()

    # ── Info panel & radar ──
    coord_label.config(text=f"Object Location: {cx}, {cy}")
    draw_radar(cx, cy)

    # ── Display video frame ──
    _show_frame(frame)

    root.after(16, update)   # target ~60 fps  (use 33 for ~30 fps)


def _show_frame(frame):
    """Convert a BGR frame to a Tk image and push it to the label.
    Extracted so the no-detection path can also update the video feed."""
    rgb   = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    img   = Image.fromarray(rgb)
    imgtk = ImageTk.PhotoImage(image=img)
    video_label.imgtk = imgtk          # keep reference alive
    video_label.configure(image=imgtk)


# ─────────────────────────────────────────────
# START
# ─────────────────────────────────────────────

root.after(16, update)
root.mainloop()

cap.release()
cv2.destroyAllWindows()