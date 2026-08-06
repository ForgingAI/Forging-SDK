export interface TriviaQuestion {
  readonly id: string
  readonly prompt: string
  readonly options: readonly string[]
  readonly correctIdx: number
}

export const QUESTIONS: readonly TriviaQuestion[] = [
  {
    id: 'q1',
    prompt: 'Which planet has the most moons?',
    options: ['Jupiter', 'Saturn', 'Uranus', 'Neptune'],
    correctIdx: 1,
  },
  {
    id: 'q2',
    prompt: 'What year did the first iPhone launch?',
    options: ['2005', '2006', '2007', '2008'],
    correctIdx: 2,
  },
  {
    id: 'q3',
    prompt: 'Which element has the symbol "Au"?',
    options: ['Silver', 'Gold', 'Aluminum', 'Argon'],
    correctIdx: 1,
  },
  {
    id: 'q4',
    prompt: 'Which language has the most native speakers?',
    options: ['English', 'Spanish', 'Mandarin Chinese', 'Hindi'],
    correctIdx: 2,
  },
  {
    id: 'q5',
    prompt: 'The Pythagorean theorem relates the sides of which shape?',
    options: ['Equilateral triangle', 'Right triangle', 'Isosceles triangle', 'Any triangle'],
    correctIdx: 1,
  },
]
