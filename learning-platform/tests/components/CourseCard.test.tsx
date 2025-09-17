import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, mockCourse } from '../utils/test-helpers';
import { CourseCard } from '../../src/components/courses/CourseCard';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate
}));

describe('CourseCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const defaultProps = {
    course: mockCourse,
    onClick: jest.fn(),
    onEnroll: jest.fn()
  };

  it('should render course information correctly', () => {
    renderWithProviders(<CourseCard {...defaultProps} />);

    expect(screen.getByText(mockCourse.title)).toBeInTheDocument();
    expect(screen.getByText(mockCourse.description)).toBeInTheDocument();
    expect(screen.getByText(`$${mockCourse.price}`)).toBeInTheDocument();
    expect(screen.getByText(mockCourse.level)).toBeInTheDocument();
    expect(screen.getByText(/150 students/i)).toBeInTheDocument();
    expect(screen.getByText(/4.5/)).toBeInTheDocument(); // Rating
  });

  it('should display duration correctly', () => {
    renderWithProviders(<CourseCard {...defaultProps} />);

    // 3600 seconds = 1 hour
    expect(screen.getByText(/1h/)).toBeInTheDocument();
  });

  it('should display difficulty level badge', () => {
    renderWithProviders(<CourseCard {...defaultProps} />);

    const levelBadge = screen.getByText('beginner');
    expect(levelBadge).toBeInTheDocument();
    expect(levelBadge).toHaveClass('difficulty-beginner');
  });

  it('should render rating stars', () => {
    renderWithProviders(<CourseCard {...defaultProps} />);

    const stars = screen.getAllByTestId('star-icon');
    expect(stars).toHaveLength(5);

    // Check that 4.5 rating shows 4 full stars and 1 half star
    const fullStars = stars.filter(star => star.classList.contains('star-full'));
    const halfStars = stars.filter(star => star.classList.contains('star-half'));
    const emptyStars = stars.filter(star => star.classList.contains('star-empty'));

    expect(fullStars).toHaveLength(4);
    expect(halfStars).toHaveLength(1);
    expect(emptyStars).toHaveLength(0);
  });

  it('should handle card click', () => {
    renderWithProviders(<CourseCard {...defaultProps} />);

    const card = screen.getByTestId('course-card');
    fireEvent.click(card);

    expect(defaultProps.onClick).toHaveBeenCalledWith(mockCourse);
  });

  it('should handle enroll button click', async () => {
    renderWithProviders(<CourseCard {...defaultProps} />);

    const enrollButton = screen.getByRole('button', { name: /enroll now/i });
    fireEvent.click(enrollButton);

    expect(defaultProps.onEnroll).toHaveBeenCalledWith(mockCourse.id);
  });

  it('should show enrolled state when user is enrolled', () => {
    const enrolledCourse = {
      ...mockCourse,
      isEnrolled: true
    };

    renderWithProviders(
      <CourseCard {...defaultProps} course={enrolledCourse} />
    );

    expect(screen.getByText(/enrolled/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue learning/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /enroll now/i })).not.toBeInTheDocument();
  });

  it('should show progress when user has progress', () => {
    const courseWithProgress = {
      ...mockCourse,
      isEnrolled: true,
      progress: 45
    };

    renderWithProviders(
      <CourseCard {...defaultProps} course={courseWithProgress} />
    );

    expect(screen.getByText(/45% complete/i)).toBeInTheDocument();
    
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toBeInTheDocument();
    expect(progressBar).toHaveAttribute('aria-valuenow', '45');
  });

  it('should show free badge for free courses', () => {
    const freeCourse = {
      ...mockCourse,
      price: 0
    };

    renderWithProviders(
      <CourseCard {...defaultProps} course={freeCourse} />
    );

    expect(screen.getByText(/free/i)).toBeInTheDocument();
    expect(screen.queryByText(/^\$/)).not.toBeInTheDocument();
  });

  it('should show instructor information', () => {
    const courseWithInstructor = {
      ...mockCourse,
      instructor: {
        id: '1',
        name: 'John Doe',
        avatar: 'avatar-url.jpg',
        bio: 'Expert instructor'
      }
    };

    renderWithProviders(
      <CourseCard {...defaultProps} course={courseWithInstructor} />
    );

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByAltText('John Doe')).toBeInTheDocument();
  });

  it('should handle favorite toggle', async () => {
    const mockToggleFavorite = jest.fn();
    
    renderWithProviders(
      <CourseCard 
        {...defaultProps} 
        onToggleFavorite={mockToggleFavorite}
      />
    );

    const favoriteButton = screen.getByRole('button', { name: /add to favorites/i });
    fireEvent.click(favoriteButton);

    expect(mockToggleFavorite).toHaveBeenCalledWith(mockCourse.id);
  });

  it('should show favorited state', () => {
    const favoritedCourse = {
      ...mockCourse,
      isFavorited: true
    };

    renderWithProviders(
      <CourseCard {...defaultProps} course={favoritedCourse} />
    );

    expect(screen.getByRole('button', { name: /remove from favorites/i })).toBeInTheDocument();
    expect(screen.getByTestId('heart-icon-filled')).toBeInTheDocument();
  });

  it('should display course thumbnail', () => {
    const courseWithThumbnail = {
      ...mockCourse,
      thumbnail: 'https://example.com/thumbnail.jpg'
    };

    renderWithProviders(
      <CourseCard {...defaultProps} course={courseWithThumbnail} />
    );

    const thumbnail = screen.getByAltText(mockCourse.title);
    expect(thumbnail).toBeInTheDocument();
    expect(thumbnail).toHaveAttribute('src', courseWithThumbnail.thumbnail);
  });

  it('should show course tags', () => {
    const courseWithTags = {
      ...mockCourse,
      tags: ['JavaScript', 'Frontend', 'React']
    };

    renderWithProviders(
      <CourseCard {...defaultProps} course={courseWithTags} />
    );

    expect(screen.getByText('JavaScript')).toBeInTheDocument();
    expect(screen.getByText('Frontend')).toBeInTheDocument();
    expect(screen.getByText('React')).toBeInTheDocument();
  });

  it('should handle discount pricing', () => {
    const discountedCourse = {
      ...mockCourse,
      price: 199.99,
      discountedPrice: 99.99
    };

    renderWithProviders(
      <CourseCard {...defaultProps} course={discountedCourse} />
    );

    expect(screen.getByText('$99.99')).toBeInTheDocument(); // Current price
    expect(screen.getByText('$199.99')).toBeInTheDocument(); // Original price
    
    const originalPrice = screen.getByText('$199.99');
    expect(originalPrice).toHaveClass('line-through');
  });

  it('should show bestseller badge', () => {
    const bestsellerCourse = {
      ...mockCourse,
      isBestseller: true
    };

    renderWithProviders(
      <CourseCard {...defaultProps} course={bestsellerCourse} />
    );

    expect(screen.getByText(/bestseller/i)).toBeInTheDocument();
  });

  it('should be keyboard accessible', () => {
    renderWithProviders(<CourseCard {...defaultProps} />);

    const card = screen.getByTestId('course-card');
    expect(card).toHaveAttribute('tabIndex', '0');

    fireEvent.keyDown(card, { key: 'Enter' });
    expect(defaultProps.onClick).toHaveBeenCalledWith(mockCourse);

    fireEvent.keyDown(card, { key: ' ' });
    expect(defaultProps.onClick).toHaveBeenCalledTimes(2);
  });

  it('should have proper ARIA attributes', () => {
    renderWithProviders(<CourseCard {...defaultProps} />);

    const card = screen.getByTestId('course-card');
    expect(card).toHaveAttribute('role', 'article');
    expect(card).toHaveAttribute('aria-label', `Course: ${mockCourse.title}`);

    const enrollButton = screen.getByRole('button', { name: /enroll now/i });
    expect(enrollButton).toHaveAttribute('aria-describedby', 'course-description');
  });

  it('should handle loading state during enrollment', async () => {
    const slowEnrollment = jest.fn(() => 
      new Promise(resolve => setTimeout(resolve, 1000))
    );

    renderWithProviders(
      <CourseCard {...defaultProps} onEnroll={slowEnrollment} />
    );

    const enrollButton = screen.getByRole('button', { name: /enroll now/i });
    fireEvent.click(enrollButton);

    await waitFor(() => {
      expect(screen.getByText(/enrolling/i)).toBeInTheDocument();
    });

    expect(enrollButton).toBeDisabled();
  });

  it('should display course certificate info', () => {
    const courseWithCertificate = {
      ...mockCourse,
      hasCertificate: true
    };

    renderWithProviders(
      <CourseCard {...defaultProps} course={courseWithCertificate} />
    );

    expect(screen.getByText(/certificate included/i)).toBeInTheDocument();
    expect(screen.getByTestId('certificate-icon')).toBeInTheDocument();
  });

  it('should show course prerequisites', () => {
    const courseWithPrerequisites = {
      ...mockCourse,
      prerequisites: ['Basic HTML', 'CSS Fundamentals']
    };

    renderWithProviders(
      <CourseCard {...defaultProps} course={courseWithPrerequisites} />
    );

    expect(screen.getByText(/prerequisites/i)).toBeInTheDocument();
    expect(screen.getByText('Basic HTML')).toBeInTheDocument();
    expect(screen.getByText('CSS Fundamentals')).toBeInTheDocument();
  });

  it('should handle course preview', () => {
    const mockOnPreview = jest.fn();
    
    renderWithProviders(
      <CourseCard {...defaultProps} onPreview={mockOnPreview} />
    );

    const previewButton = screen.getByRole('button', { name: /preview/i });
    fireEvent.click(previewButton);

    expect(mockOnPreview).toHaveBeenCalledWith(mockCourse.id);
  });
});