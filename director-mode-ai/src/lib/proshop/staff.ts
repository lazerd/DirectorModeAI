// The Pro Shop staff: who they are, what they do, the rules they never break, and the
// plays that move several of them at once. Shared by the /proshop page (via
// /api/proshop/state) and the Ask Claude "proshop" pack (persona + order routing).
// Nothing here is club data: every club gets the same staff, and each club's real
// state (orders, huddle, "right now" lines) lives in the proshop_* tables.

export interface StaffMember {
  id: string; name: string; role: string; station: string;
  /** Hotspot position on the scene art, in percent. */
  x: number; y: number; color: string;
  jobs: string[]; rules: string[]; cmds: string[];
}
export interface PlayStep { agent: string; text: string }
export interface Play { id: string; name: string; when: string; ask: string; steps: PlayStep[] }

export const STAFF: StaffMember[] = [
  {
    "id": "ledger",
    "name": "Ledger",
    "role": "Billing",
    "station": "cash register",
    "x": 10.4,
    "y": 27,
    "color": "#E8A33A",
    "jobs": [
      "Reads every pro's calendar each night and lists lessons to bill",
      "Bills lessons, clinic drop-ins, socials and stringing",
      "Credits and refunds only when a family asks",
      "Bills the household, never twice"
    ],
    "rules": [
      "Never charges without your yes",
      "Never bills a household twice",
      "Refunds only when a family asks"
    ],
    "cmds": [
      "Charge yesterday's lessons",
      "Who came to clinic but isn't registered?",
      "Reverse the duplicate on the Patel account"
    ]
  },
  {
    "id": "proshop",
    "name": "Pro Shop",
    "role": "Stringing & balls",
    "station": "stringing machine",
    "x": 29,
    "y": 16,
    "color": "#4FA3D9",
    "jobs": [
      "Logs stringing jobs and charges them",
      "Ball pre-book and inventory",
      "Demo rackets and brand reps",
      "Compares vendor prices"
    ],
    "rules": [
      "Charges stringing only after the racket is done",
      "Three quotes before any big order"
    ],
    "cmds": [
      "Who hasn't picked up their racket?",
      "How many cases of balls are left?",
      "Compare ball quotes"
    ]
  },
  {
    "id": "frontdesk",
    "name": "Front Desk",
    "role": "Inbox & sign-ups",
    "station": "front desk",
    "x": 41,
    "y": 27,
    "color": "#9B7BD8",
    "jobs": [
      "Your inbox, one email at a time",
      "Drafts replies in your voice",
      "Emails your pros",
      "Builds programs and sign-ups"
    ],
    "rules": [
      "Never sends, only drafts you read",
      "One email at a time, newest first"
    ],
    "cmds": [
      "Next email",
      "Reply to the newest parent email",
      "Build the winter clinic sign-up"
    ]
  },
  {
    "id": "courts",
    "name": "Court Marshal",
    "role": "Court booking",
    "station": "court board",
    "x": 54,
    "y": 24,
    "color": "#3FB37F",
    "jobs": [
      "Books league matches from the schedule",
      "Handles captain reschedules",
      "Blocks courts for clinics, camps, events",
      "Knows your court rules"
    ],
    "rules": [
      "Follows your court rules",
      "Never double-books a court"
    ],
    "cmds": [
      "A captain needs 3 courts Friday, what's open?",
      "Block courts 1–4 for Saturday's social",
      "Who's on which courts tomorrow?"
    ]
  },
  {
    "id": "league",
    "name": "League Desk",
    "role": "Teams & captains",
    "station": "bulletin board",
    "x": 70,
    "y": 31,
    "color": "#E06A8C",
    "jobs": [
      "Team polls, captains and registration links",
      "Lineups and scores",
      "Team fees by member and guest rate",
      "Match ball counts"
    ],
    "rules": [
      "Nudges one person at a time, never a blast",
      "Bills fees at member and guest rates"
    ],
    "cmds": [
      "Who hasn't answered the team poll? Nudge them",
      "Enter Saturday's scores",
      "Which teams still owe fees?"
    ]
  },
  {
    "id": "grounds",
    "name": "Groundskeeper",
    "role": "Weather & courts",
    "station": "window",
    "x": 84,
    "y": 33,
    "color": "#5BB8B0",
    "jobs": [
      "Rain calls: cancels everywhere and emails families",
      "Schedules make-ups, hands credits to Ledger",
      "Court maintenance vendors",
      "Lights and windscreens"
    ],
    "rules": [
      "Checks the forecast before calling rain",
      "Credits go through Ledger"
    ],
    "cmds": [
      "It's raining, cancel today's junior classes",
      "Courts are wet, push the 9am clinic to 10",
      "When are the courts resurfaced?"
    ]
  },
  {
    "id": "pay",
    "name": "Paymaster",
    "role": "Payroll",
    "station": "back office",
    "x": 11,
    "y": 55,
    "color": "#C98B5A",
    "jobs": [
      "Payroll from billing, every pay period",
      "Coverage and absences",
      "Reimbursements from a receipt photo",
      "Shows everyone's pay before it's filed"
    ],
    "rules": [
      "Shows everyone's pay before it's filed",
      "Never guesses hours"
    ],
    "cmds": [
      "Run payroll for this period",
      "Jordan covered Kim's clinic, pay Jordan",
      "Expense this receipt"
    ]
  },
  {
    "id": "host",
    "name": "Event Host",
    "role": "Socials & tournaments",
    "station": "DJ booth",
    "x": 33,
    "y": 54,
    "color": "#F07B4F",
    "jobs": [
      "Socials and mixers: sign-up, cap, flyer",
      "Tournament draws and schedules",
      "Bills the event afterward",
      "The year's event calendar"
    ],
    "rules": [
      "Asks you the time, never guesses",
      "Bills after the event, in case of rain"
    ],
    "cmds": [
      "Who's signed up for the mixer?",
      "Build the draw for Saturday",
      "Bill last week's social"
    ]
  },
  {
    "id": "juniors",
    "name": "Junior Coach",
    "role": "Juniors & camps",
    "station": "junior wall",
    "x": 51,
    "y": 61,
    "color": "#8CC63F",
    "jobs": [
      "Attendance and missed-class alerts",
      "Monthly junior billing with sibling discounts",
      "Camp rosters",
      "Finds kids who stopped coming"
    ],
    "rules": [
      "Sibling discounts, one charge per family",
      "Never contacts a family without your OK"
    ],
    "cmds": [
      "Run this month's junior billing",
      "Write notes to the kids who stopped coming",
      "Who's in Tuesday's class?"
    ]
  },
  {
    "id": "analyst",
    "name": "Analyst",
    "role": "Reports & board",
    "station": "board room",
    "x": 77,
    "y": 58,
    "color": "#6C8CD5",
    "jobs": [
      "Program P&L, this year vs last",
      "Court use and growth",
      "Member participation",
      "Board handouts"
    ],
    "rules": [
      "Compares the same months year to year",
      "Every number has a source"
    ],
    "cmds": [
      "How did last month go vs last year?",
      "Who took clinics last season but not this one?",
      "Make a one-page board update"
    ]
  }
];

export const PLAYS: Play[] = [
  {
    "id": "rain",
    "name": "Rain out",
    "when": "It's pouring and programs start soon",
    "ask": "What's cancelled? (e.g. today's 3:30 juniors)",
    "steps": [
      {
        "agent": "grounds",
        "text": "Check the forecast, confirm the call"
      },
      {
        "agent": "juniors",
        "text": "Draft one email to every family in the cancelled classes"
      },
      {
        "agent": "courts",
        "text": "Clear the court blocks, tell any captains"
      },
      {
        "agent": "ledger",
        "text": "No charges for cancelled sessions"
      },
      {
        "agent": "pay",
        "text": "Note the cancellations on payroll"
      }
    ]
  },
  {
    "id": "fill",
    "name": "Fill a cancelled lesson",
    "when": "Someone cancels a lesson",
    "ask": "Who cancelled, and when?",
    "steps": [
      {
        "agent": "analyst",
        "text": "Find 3 members who book that time and level"
      },
      {
        "agent": "frontdesk",
        "text": "Draft a short personal note to each"
      },
      {
        "agent": "courts",
        "text": "Hold the court until someone says yes"
      },
      {
        "agent": "ledger",
        "text": "Bill whoever takes it"
      }
    ]
  },
  {
    "id": "close",
    "name": "Month-end close",
    "when": "The last day of the month",
    "ask": "",
    "steps": [
      {
        "agent": "juniors",
        "text": "Run junior billing from attendance"
      },
      {
        "agent": "ledger",
        "text": "Sweep for anything unbilled"
      },
      {
        "agent": "league",
        "text": "Check every team fee is billed"
      },
      {
        "agent": "pay",
        "text": "Build payroll and show everyone's pay"
      },
      {
        "agent": "analyst",
        "text": "One-page month vs last year"
      }
    ]
  },
  {
    "id": "winback",
    "name": "Win them back",
    "when": "Programs are quieter than last month",
    "ask": "",
    "steps": [
      {
        "agent": "juniors",
        "text": "List kids who stopped coming"
      },
      {
        "agent": "analyst",
        "text": "List adults who dropped out of clinics"
      },
      {
        "agent": "frontdesk",
        "text": "One personal note per family, no blast"
      },
      {
        "agent": "ledger",
        "text": "Show what they're worth per month"
      }
    ]
  },
  {
    "id": "social",
    "name": "Throw a social",
    "when": "You want an event on the calendar",
    "ask": "What, when, price and cap?",
    "steps": [
      {
        "agent": "host",
        "text": "Build the event with the cap and price"
      },
      {
        "agent": "courts",
        "text": "Block the courts"
      },
      {
        "agent": "frontdesk",
        "text": "Flyer and a note to the teams you pick"
      },
      {
        "agent": "ledger",
        "text": "Bill everyone after the event"
      }
    ]
  },
  {
    "id": "board",
    "name": "Board meeting prep",
    "when": "A week before the board meets",
    "ask": "",
    "steps": [
      {
        "agent": "analyst",
        "text": "P&L this year vs last, court use, members"
      },
      {
        "agent": "analyst",
        "text": "Two-page handout that prints clean"
      }
    ]
  }
];

export const HINTS: string[] = ["It's raining, cancel today's junior classes","Bill everything from yesterday","Who stopped coming this month?","Fill Sam's 4pm Thursday lesson"];

export const STAFF_IDS = new Set(STAFF.map((s) => s.id));
export const staffById = (id: string) => STAFF.find((s) => s.id === id) ?? null;
